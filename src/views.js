import {
  CARDIOMETABOLIC_TARGET_DEFAULTS,
  CONFIDENCE_LEVELS,
  LIBRARY_ITEM_TYPES,
  MACRO_NUTRIENTS,
  NUTRIENTS,
  NUTRIENT_SOURCES,
  SOURCE_NUTRIENTS,
  WEEKDAYS
} from './constants.js';
import { FOOD_CLASSIFICATIONS } from './sugar.js';
import { groupMealEntries, MEAL_TYPES, suggestMealIdentity } from './meals.js';
import {
  cmToIn,
  dailySummary,
  isSupplementScheduled,
  kgToLb,
  mlToFlOz,
  nutrientValue,
  resolveEffectiveTargets,
  supplementCompletionSummary,
  weeklyCoverage
} from './calculations.js';
import { progressSummary, rollingWeightSeries } from './trends.js';
import { todayMetrics } from './today-metrics.js';
import { analysisProvider } from './services/anthropic.js';
import { drinkFluidMl } from './fluids.js';
import { PRESET_GROUPS } from './presets.js';

const DISCLAIMER = 'This app estimates nutrition and is not medical or dietetic advice. Targets are general references you can edit. Consult a qualified professional for personal medical or nutrition guidance.';

const ROUTES = Object.freeze([
  { id: 'today', label: 'Today', icon: '◎' },
  { id: 'add', label: 'Add', icon: '+' },
  { id: 'library', label: 'Library', icon: '▦' },
  { id: 'progress', label: 'Progress', icon: '↗' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
]);

const escapeHtml = value => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const checked = value => value ? ' checked' : '';
const selected = (actual, expected) => actual === expected ? ' selected' : '';
const format = (value, digits = 0) => Number(value).toLocaleString('en-US', {
  maximumFractionDigits: digits,
  minimumFractionDigits: digits
});

export const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
  month: 'long', day: 'numeric'
});

const itemTypeLabel = type => LIBRARY_ITEM_TYPES.find(item => item.id === type)?.label ?? 'Item';
const sourceLabel = source => NUTRIENT_SOURCES.find(item => item.id === source)?.label
  ?? (source === 'snapshot' ? 'Saved snapshot' : 'Recorded value');

const COVERAGE_LABELS = Object.freeze({
  met: '✓ Met',
  inProgress: '◐ In progress',
  unknown: '? Unknown',
  attention: '! Needs source',
  high: '↑ Above reference'
});

// Twelve significant digits hide floating-point noise such as 7.8500000000000005 without rounding real values.
const editableNumber = value => String(Number(value.toPrecision(12)));

const REVIEW_NUTRIENTS = [...MACRO_NUTRIENTS, ...NUTRIENTS.filter(nutrient => !MACRO_NUTRIENTS.some(macro => macro.key === nutrient.key))];

function nutrientSummary(values) {
  const known = REVIEW_NUTRIENTS
    .map(definition => [definition, nutrientValue(values ?? {}, definition)])
    .filter(([, value]) => Number.isFinite(value));
  return known.length ? known.map(([definition, value]) => `${definition.label} ${formatNutrient(value, definition.unit)}`).join(' · ') : 'Unknown';
}

function formatNutrient(value, unit) {
  if (!Number.isFinite(value)) return 'Unknown';
  const digits = Math.abs(value) < 10 && !Number.isInteger(value) ? 1 : 0;
  return `${format(value, digits)} ${unit}`;
}

function formatWater(ml, units) {
  return units === 'imperial'
    ? `${format(mlToFlOz(ml), 1)} fl oz`
    : `${format(ml)} ml`;
}

function scheduleLabel(schedule) {
  if (schedule?.frequency === 'daily') return 'Daily';
  if (['weekly', 'custom'].includes(schedule?.frequency) && Array.isArray(schedule.days)) {
    return schedule.days.map(day => WEEKDAYS[day]).filter(Boolean).join(', ') || 'Choose days';
  }
  return 'No schedule';
}

function sortedLibrary(library, query = '') {
  const normalized = query.trim().toLocaleLowerCase();
  return library
    .filter(item => !normalized || [item.name, item.servingLabel, item.type]
      .some(value => String(value ?? '').toLocaleLowerCase().includes(normalized)))
    .sort((left, right) => Number(Boolean(right.favorite)) - Number(Boolean(left.favorite))
      || String(right.lastUsedAt ?? right.updatedAt ?? '').localeCompare(String(left.lastUsedAt ?? left.updatedAt ?? ''))
      || left.name.localeCompare(right.name));
}

function routeTitle(route) {
  return ROUTES.find(item => item.id === route)?.label ?? 'Today';
}

function renderNav(activeRoute) {
  return `<nav class="bottom-nav" aria-label="Primary">
    ${ROUTES.map(route => `<button class="nav-item${route.id === activeRoute ? ' is-active' : ''}" type="button" data-action="navigate" data-route="${route.id}"${route.id === activeRoute ? ' aria-current="page"' : ''}>
      <span class="nav-icon" aria-hidden="true">${route.icon}</span>
      <span>${route.label}</span>
    </button>`).join('')}
  </nav>`;
}

function renderProfileFields(profile, units, prefix, { showPreferences = false } = {}) {
  const imperial = units === 'imperial';
  const height = imperial ? cmToIn(profile.heightCm) : profile.heightCm;
  const weight = imperial ? kgToLb(profile.weightKg) : profile.weightKg;
  return `<div class="field-grid">
    <label>Age
      <input name="age" type="number" min="18" max="120" step="1" value="${escapeHtml(profile.age)}" required>
    </label>
    <label>Sex used for BMR
      <select name="sexForBmr">
        <option value="female"${selected(profile.sexForBmr, 'female')}>Female</option>
        <option value="male"${selected(profile.sexForBmr, 'male')}>Male</option>
      </select>
    </label>
    <label>Height (${imperial ? 'in' : 'cm'})
      <input name="height" type="number" min="${imperial ? 39 : 100}" max="${imperial ? 98 : 250}" step="0.01" value="${format(height, 2)}" required data-canonical-field="heightCm">
    </label>
    <label>Weight (${imperial ? 'lb' : 'kg'})
      <input name="weight" type="number" min="${imperial ? 55 : 25}" max="${imperial ? 882 : 400}" step="0.01" value="${format(weight, 2)}" required data-canonical-field="weightKg">
    </label>
    <label>Average daily steps
      <input name="averageSteps" type="number" min="0" max="100000" step="100" value="${escapeHtml(profile.averageSteps)}">
    </label>
    <label>Planned strength days
      <input name="liftDaysPerWeek" type="number" min="0" max="6" step="1" value="${escapeHtml(profile.liftDaysPerWeek)}" required>
    </label>
    <label class="field-wide">Activity estimate
      <select name="activityMultiplier">
        <option value="1.2"${selected(profile.activityMultiplier, 1.2)}>Mostly sedentary</option>
        <option value="1.35"${selected(profile.activityMultiplier, 1.35)}>Lightly active</option>
        <option value="1.45"${selected(profile.activityMultiplier, 1.45)}>Active with regular training</option>
        <option value="1.6"${selected(profile.activityMultiplier, 1.6)}>Very active</option>
      </select>
    </label>
    ${showPreferences ? `<label>Display units
      <select name="units">
        <option value="imperial"${selected(units, 'imperial')}>US units</option>
        <option value="metric"${selected(units, 'metric')}>Metric</option>
      </select>
    </label>
    <label>Goal
      <select name="goal">
        <option value="fatLoss"${selected(profile.goal, 'fatLoss')}>Steady fat loss</option>
      </select>
    </label>` : ''}
  </div>
  ${showPreferences ? '' : `<input type="hidden" name="units" value="${escapeHtml(units)}">`}
  <input type="hidden" name="formContext" value="${escapeHtml(prefix)}">`;
}

function renderPaceOptions(pace) {
  return `<div class="choice-grid">
    <label class="choice"><input type="radio" name="pace" value="gentle"${checked(pace === 'gentle')}> <span><strong>Gentle</strong><small>About a 10% starting deficit</small></span></label>
    <label class="choice"><input type="radio" name="pace" value="moderate"${checked(pace === 'moderate')}> <span><strong>Moderate</strong><small>About a 17.5% starting deficit</small></span></label>
    <label class="choice"><input type="radio" name="pace" value="faster"${checked(pace === 'faster')}> <span><strong>Faster</strong><small>About a 25% starting deficit, capped at estimated BMR</small></span></label>
  </div>`;
}

// Forms that render their own notice; errors from any other form use the page-level alert.
const FORMS_WITH_NOTICES = new Set(['save-profile', 'save-target-overrides', 'save-heart-targets', 'set-units', 'save-tracked-nutrients',
  'save-training-behavior', 'save-water-increments', 'save-integrations', 'save-body-metric', 'confirm-item', 'reset-data', 'save-cloud']);

function formNotice(ui, formAction) {
  const notice = ui?.notice;
  if (!notice || notice.form !== formAction) return '';
  return `<p class="form-status${notice.tone === 'error' ? ' is-error' : ''}" role="${notice.tone === 'error' ? 'alert' : 'status'}">${escapeHtml(notice.text)}</p>`;
}

export function renderUpdateBanner(ui = {}) {
  return ui.updateReady
    ? '<p class="global-status update-status">A new version is ready. Save anything you are editing first. <button class="secondary-button" type="button" data-action="apply-update">Update now</button></p>'
    : '';
}

export function renderInstallStatus(ui = {}) {
  return `<p>${escapeHtml(ui.installStatus || 'Preparing offline access. Once this page has loaded online, saved tracking works without a connection.')}</p>${ui.canInstall ? '<button class="secondary-button" type="button" data-action="install-app">Install app</button>' : '<p class="muted">On iPhone or iPad, open this page in Safari, tap Share, then Add to Home Screen. On other browsers, use the browser menu to install when offered.</p>'}`;
}

export function renderTargetCards(targets, { showDerivation = true } = {}) {
  if (!targets) return '<p class="muted">Complete the profile to calculate a starting reference.</p>';
  return `<div class="metric-grid">
    <article><span>Weekly average</span><strong>${format(targets.averageCalories)} kcal</strong></article>
    <article><span>Training day</span><strong>${format(targets.trainingDayCalories)} kcal</strong></article>
    <article><span>Rest day</span><strong>${format(targets.restDayCalories)} kcal</strong></article>
    <article><span>Protein</span><strong>${format(targets.proteinG)} g</strong></article>
    <article><span>Fiber</span><strong>${format(targets.fiberG)} g</strong></article>
    <article><span>Water</span><strong>${format(targets.waterMl)} ml</strong></article>
  </div>
  ${showDerivation ? `<p class="explanation">Based on an estimated ${format(targets.bmr)} kcal BMR and ${format(targets.maintenanceCalories)} kcal maintenance level. These are editable planning references, not guarantees.</p>` : ''}`;
}

function renderEntryList(entries, data, selectedDate) {
  const favorites = new Set(data.library.filter(item => item.favorite).map(item => item.id));
  return `<ul class="plain-list">${entries.map(entry => { const favorite = favorites.has(entry.itemId); return `<li><span><strong>${escapeHtml(entry.name)}</strong><small>${format(entry.servings, 2)} × ${escapeHtml(entry.servingLabel)}</small></span><span>
    <button class="quiet-button icon-button favorite-toggle" type="button" data-action="favorite-log-entry" data-entry-id="${escapeHtml(entry.id)}" aria-pressed="${favorite}" aria-label="${favorite ? `Remove ${escapeHtml(entry.name)} from favorites` : `Save ${escapeHtml(entry.name)} as a favorite`}">${favorite ? '★' : '☆'}</button>
    <button class="quiet-button" type="button" data-action="edit-log-entry" data-entry-id="${escapeHtml(entry.id)}">Edit</button>
    <button class="quiet-button" type="button" data-action="delete-log-entry" data-entry-id="${escapeHtml(entry.id)}" aria-label="Delete ${escapeHtml(entry.name)} from ${escapeHtml(dateLabel(selectedDate))}">Delete</button>
  </span></li>`; }).join('')}</ul>`;
}

const GL_STATES = Object.freeze({
  low: '✓ Low', moderate: '◐ Moderate', possiblyHigh: '↑? Possibly high', high: '↑ High', partial: '? Partly known', unknown: '? Unknown'
});
const one = value => format(value, 1);

function mealGlDisplay(metrics) {
  if (metrics.glCompleteness === 'unknown') return 'Estimated GL unknown';
  if (metrics.glCompleteness === 'partial') return `At least ${one(metrics.gl)} GL (estimated)`;
  return `Estimated GL ${one(metrics.gl)}${metrics.glRange && metrics.glRange.min !== metrics.glRange.max ? ` (${one(metrics.glRange.min)} to ${one(metrics.glRange.max)})` : ''}`;
}

function renderMealDetails(meal) {
  if (!meal?.metrics) return '';
  const metrics = meal.metrics;
  const rows = meal.entries.map(entry => {
    const evidence = entry.glycemic;
    const components = (evidence?.components ?? []).filter(component => component.material !== false || component.gi);
    return `<li><div><strong>${escapeHtml(entry.name)}</strong><small>${Number.isFinite(evidence?.gl) && evidence.completeness !== 'unknown' ? `GL ${escapeHtml(one(evidence.gl))}${evidence.completeness === 'partial' ? ' (partly known)' : ''}` : 'GL unknown'} · ${escapeHtml(formatNutrient(entry.nutrients?.carbsG, 'g'))} carbohydrate · ${escapeHtml(formatNutrient(entry.nutrients?.fiberG, 'g'))} fiber</small>
      ${components.length ? `<ul class="detail-list">${components.map(component => `<li><span>${escapeHtml(component.name)}: ${component.gi ? `GI ${escapeHtml(component.gi.value)}${component.gi.range ? ` (${escapeHtml(one(component.gi.range.min))} to ${escapeHtml(one(component.gi.range.max))})` : ''} as ${escapeHtml(component.gi.referenceName ?? 'a match')}, ${escapeHtml(component.gi.confidence ?? 'low')} confidence, <a href="${escapeHtml(component.gi.sourceUrl ?? '')}" target="_blank" rel="noreferrer">${escapeHtml(component.gi.sourceName ?? 'source')}</a>` : 'no GI match'}</span><span>${escapeHtml(formatNutrient(component.availableCarbsG, 'g'))} available</span></li>`).join('')}</ul>` : ''}</div></li>`;
  }).join('');
  return `<dialog class="meal-dialog" tabindex="-1" aria-labelledby="meal-detail-title">
    <div class="dialog-heading"><div><span class="flag">${escapeHtml(GL_STATES[metrics.glState])}</span><h2 id="meal-detail-title">${escapeHtml(mealTypeLabel(meal.mealType))} details</h2></div><button class="quiet-button icon-button" type="button" data-action="close-meal-details" aria-label="Close meal details">×</button></div>
    <div class="detail-total"><strong>${escapeHtml(mealGlDisplay(metrics))}</strong><span>Fiber ratio ${escapeHtml(metrics.fiberCarbLabel)} · Protein ${escapeHtml(formatNutrient(metrics.proteinG, 'g'))}</span></div>
    <section aria-labelledby="meal-foods-heading"><h3 id="meal-foods-heading">Foods and GI matches</h3><ul class="detail-list">${rows}</ul></section>
    ${metrics.missingGiItems.length ? `<p class="detail-label">GI unavailable for: ${escapeHtml(metrics.missingGiItems.join(', '))}. Their GL is not counted, so the total is a lower bound.</p>` : ''}
    <section class="evidence-note" aria-labelledby="meal-formula-heading"><h3 id="meal-formula-heading">How this is estimated</h3>
      <p>GL = GI × available carbohydrate ÷ 100, where available carbohydrate is carbohydrate minus fiber. Above 20 is high, 11 to 20 moderate, 10 or less low. A meal is marked high only when even the low end of its range is above 20.</p>
      <p>This is a planning estimate, not a prediction of your own glucose response. Portion, preparation, ripeness, and the rest of the meal all change it. Protein and fat are shown for context and are not subtracted.</p></section>
  </dialog>`;
}

function renderSupplementSchedule(data, selectedDate) {
  const completion = supplementCompletionSummary(data.dayState, selectedDate);
  const completedIds = new Set(completion.items.map(item => item.id));
  const currentById = new Map(data.library
    .filter(item => item.type === 'supplement')
    .map(item => [item.id, item]));
  const scheduled = data.library.filter(item => isSupplementScheduled(item, selectedDate)
    && !completedIds.has(item.id));
  const rows = [
    ...completion.items.map(item => {
      const current = currentById.get(item.id);
      const completionControl = current
        ? `<button class="secondary-button" type="button" data-action="toggle-supplement" data-item-id="${escapeHtml(item.id)}" data-completed="false" aria-pressed="true">Completed</button>`
        : '<span class="completion-badge">✓ Completed</span>';
      return `<li><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.servingLabel)}${item.schedule ? ` · ${escapeHtml(scheduleLabel(item.schedule))}` : ''}</small></span>${completionControl}</li>`;
    }),
    ...scheduled.map(item => `<li><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.servingLabel)} · ${escapeHtml(scheduleLabel(item.schedule))}</small></span><button class="primary-button" type="button" data-action="toggle-supplement" data-item-id="${escapeHtml(item.id)}" data-completed="true" aria-pressed="false">Mark complete</button></li>`)
  ];
  const limitations = completion.limitations;
  const limitation = limitations.length
    ? `<p class="muted" role="status">Historical nutrient totals are unavailable for ${limitations.length} completed supplement${limitations.length === 1 ? '' : 's'} because an exact label snapshot was not stored.</p>`
    : '';
  if (!rows.length) return `<p class="muted">No supplements are scheduled for this date.</p>${limitation}`;
  return `<ul class="plain-list">${rows.join('')}</ul>${limitation}`;
}

function renderNutrientReferences(item) {
  const references = [];
  if (Number.isFinite(item.targetMin)) {
    const label = Number.isFinite(item.targetPreferred) ? 'Adequacy and planning range' : 'Adequacy target';
    const value = Number.isFinite(item.targetPreferred)
      ? `${formatNutrient(item.targetMin, item.unit)} to ${formatNutrient(item.targetPreferred, item.unit)} across seven days`
      : `${formatNutrient(item.targetMin, item.unit)} across seven days`;
    references.push(`<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`);
  }
  if (Number.isFinite(item.targetMax)) {
    references.push(`<div><dt>Rolling seven-day maximum</dt><dd>${escapeHtml(formatNutrient(item.targetMax, item.unit))}</dd></div>`);
  }
  if (item.highReason?.type === 'dailyUpperLimit') {
    references.push(`<div><dt>Daily upper-limit trigger</dt><dd>${escapeHtml(dateLabel(item.highReason.date))}: ${escapeHtml(formatNutrient(item.highReason.amount, item.unit))} confirmed against the ${escapeHtml(formatNutrient(item.highReason.threshold, item.unit))} daily upper limit.</dd></div>`);
  }
  return references.length
    ? `<dl class="reference-list">${references.join('')}</dl>`
    : '<p class="muted">No numeric reference is configured.</p>';
}

function renderNutrientDetails(item) {
  if (!item) return '';
  const contributors = item.contributors.length
    ? `<ul class="detail-list">${item.contributors.map(contributor => `<li><div><strong>${escapeHtml(contributor.name)}</strong><small>${escapeHtml(dateLabel(contributor.date))} · ${escapeHtml(sourceLabel(contributor.source))}</small></div><span>${escapeHtml(formatNutrient(contributor.amount, item.unit))}</span></li>`).join('')}</ul>`
    : '<p class="muted">No confirmed contributors in this seven-day window.</p>';
  const unknown = item.unknownItems.length
    ? `<p class="detail-label">Unknown in:</p><ul class="unknown-list">${item.unknownItems.map(entry => `<li>${escapeHtml(entry.name)} <small>${escapeHtml(dateLabel(entry.date))}${entry.reason === 'missingHistoricalSnapshot' ? ' · Historical label snapshot unavailable' : entry.reason === 'partial' ? ' · Partly known: some ingredients had no data' : ''}</small></li>`).join('')}</ul>`
    : '<p class="muted">Every logged item in this window reports this nutrient.</p>';
  return `<dialog class="nutrient-dialog" tabindex="-1" aria-labelledby="nutrient-detail-title">
    <div class="dialog-heading"><div><span class="coverage-state state-${escapeHtml(item.state)}">${escapeHtml(COVERAGE_LABELS[item.state])}</span><h2 id="nutrient-detail-title">${escapeHtml(item.label)} details</h2></div><button class="quiet-button icon-button" type="button" data-action="close-nutrient-details" aria-label="Close nutrient details">×</button></div>
    <div class="detail-total"><strong>${escapeHtml(formatNutrient(item.total, item.unit))}</strong><span>${item.unknownItems.length ? 'Known amount; some items are unknown' : 'Confirmed across seven days'}</span></div>
    <section aria-labelledby="contributors-heading"><h3 id="contributors-heading">Confirmed contributors</h3>${contributors}</section>
    <section aria-labelledby="unknown-heading"><h3 id="unknown-heading">Unknown-item details</h3>${unknown}</section>
    <section class="evidence-note" aria-labelledby="target-basis-heading"><h3 id="target-basis-heading">Target basis and evidence</h3>${renderNutrientReferences(item)}<p><strong>${escapeHtml(item.evidence)}</strong></p>${item.citation ? `<a href="${escapeHtml(item.citation)}" target="_blank" rel="noreferrer">Read the evidence reference</a>` : '<p class="muted">No external citation is attached to this planning reference.</p>'}</section>
  </dialog>`;
}

function coverageSummary(items) {
  const count = state => items.filter(item => item.state === state).length;
  const parts = [[count('met'), 'met'], [count('inProgress'), 'in progress'], [count('attention'), count('attention') === 1 ? 'needs a source' : 'need a source'],
    [count('unknown'), 'unknown'], [count('high'), 'above reference']].filter(([value]) => value > 0);
  return parts.map(([value, label]) => `${value} ${label}`).join(' · ') || 'No tracked nutrients';
}

function metricAmount(value, unit, units) {
  if (!Number.isFinite(value)) return 'Unknown';
  if (unit === 'ml') return formatWater(value, units);
  if (unit === 'GL') return `${format(value)} GL`;
  return formatNutrient(value, unit);
}

function metricTarget(metric, units) {
  const amount = value => metricAmount(value, metric.unit, units);
  const { min, max, ideal, preferred } = metric.target;
  if (Number.isFinite(metric.target.goal)) return `Target ${amount(metric.target.goal)}`;
  if (metric.kind === 'range') return `Target ${amount(min)} to ${amount(max)}`;
  if (metric.kind === 'minimum') return `Target ${amount(min)}${Number.isFinite(preferred) ? `, ${amount(preferred)} preferred` : ''}`;
  if (metric.id === 'transFat') return 'Target: none';
  return Number.isFinite(ideal) ? `${amount(ideal)} ideal · ${amount(max)} limit` : `${amount(max)} limit`;
}

// Each nutrient keeps one color everywhere (her pick, 2026-10-01, the "nutrient colors" design); a meal's carb or GL problem uses that nutrient's color.
function nutrientKey(id) {
  const meal = /^meal-.+-(carbs|gl)$/.exec(id);
  return meal ? meal[1] : id;
}

function renderMetricBar(metric, { expanded = false, units = 'metric', variant = '' } = {}) {
  const id = escapeHtml(metric.id);
  const bar = metric.bar ?? {};
  const pct = value => `${format(Math.max(0, Math.min(100, value)), 1)}%`;
  const left = Number.isFinite(metric.target.goal) && Number.isFinite(metric.value) && !metric.atLeast ? metric.target.goal - metric.value : null;
  const valueText = `${metric.atLeast && Number.isFinite(metric.value) ? 'At least ' : ''}${metricAmount(metric.value, metric.unit, units)}${Number.isFinite(left) ? ` · ${format(Math.abs(left))} ${left >= 0 ? 'left' : 'over'}` : ''}`;
  const contributors = metric.contributors.slice(0, 6);
  const detail = expanded ? `<div id="metric-${id}" class="metric-detail">
      <p>${escapeHtml(metric.meaning)}</p>
      <p class="muted">${escapeHtml(metric.targetNote)}</p>
      ${contributors.length ? `<h3>Where it came from</h3><ul class="contributor-list">${contributors.map(item => `<li><span><strong>${escapeHtml(item.name)}</strong>${item.estimate ? ' <small class="estimate-tag">estimate</small>' : ''}</span><span>${escapeHtml(metricAmount(item.amount, metric.unit, units))}${metric.contributors.length > 1 ? ` · ${escapeHtml(format(item.share * 100))}%` : ''}</span>${item.parts.length ? `<ul class="part-list">${item.parts.slice(0, 5).map(part => `<li><span>${escapeHtml(part.name)}</span><span>${escapeHtml(metricAmount(part.amount, metric.unit, units))}</span></li>`).join('')}</ul>` : ''}</li>`).join('')}</ul>` : ''}
      ${metric.unknownCount ? `<p class="muted">${escapeHtml(plural(metric.unknownCount, 'food'))} ${metric.unknownCount === 1 ? 'does' : 'do'} not report this, so the total may be higher.</p>` : ''}
    </div>` : '';
  return `<article class="metric-bar level-${escapeHtml(metric.level)} nutrient-${escapeHtml(nutrientKey(metric.id))}${variant ? ` metric-${variant}` : ''}">
    <button class="metric-bar-button" type="button" data-action="toggle-metric" data-metric-id="${id}" aria-expanded="${expanded}" aria-controls="metric-${id}">
      <span class="metric-bar-head"><strong>${escapeHtml(metric.label)}</strong><span>${escapeHtml(valueText)}</span></span>
      <span class="bar-track" aria-hidden="true">${Number.isFinite(bar.zoneStart) ? `<span class="bar-zone" style="left:${pct(bar.zoneStart)};width:${pct(bar.zoneEnd - bar.zoneStart)}"></span>` : ''}<span class="bar-fill" style="width:${pct(bar.fill ?? 0)}"></span>${Number.isFinite(bar.idealTick) ? `<span class="bar-tick bar-ideal" style="left:${pct(bar.idealTick)}"></span>` : ''}${Number.isFinite(bar.tick) ? `<span class="bar-tick" style="left:${pct(bar.tick)}"></span>` : ''}</span>
      <span class="metric-bar-foot"><em class="flag">${escapeHtml(`${metric.symbol} ${metric.statusLabel}`)}</em><small>${escapeHtml(metricTarget(metric, units))}</small></span>${metric.split ? `<small class="metric-split">${escapeHtml(`${metricAmount(metric.split.buttons, metric.unit, units)} water + ${metricAmount(metric.split.drinks, metric.unit, units)} from drinks`)}</small>` : ''}
    </button>${detail}
  </article>`;
}

function renderMealGroups(meals, data, selectedDate, openMeals = []) {
  if (!meals.length) return '<p class="muted">No meals logged for this date yet.</p>';
  const logged = new Map((data.log?.[selectedDate] ?? []).map(entry => [entry.id, entry]));
  return meals.map(group => {
    const key = group.mealId ?? 'unassigned';
    const open = openMeals.includes(key);
    const time = /T(\d{2}:\d{2})/.exec(String(group.consumedAt ?? ''))?.[1];
    const title = group.mealId ? `${mealTypeLabel(group.mealType)}${time ? ` · ${time}` : ''}` : 'Unassigned';
    const calories = group.entries.reduce((sum, entry) => sum + (Number.isFinite(entry.nutrients?.calories) ? entry.nutrients.calories : 0), 0);
    const metrics = group.metrics;
    const glTag = metrics && metrics.glCompleteness !== 'unknown' ? ` · <em class="flag">${escapeHtml(GL_STATES[metrics.glState])} GL</em>` : '';
    return `<article class="meal-card gl-${escapeHtml(metrics?.glState ?? 'none')}">
      <button class="meal-toggle" type="button" data-action="toggle-meal" data-meal-key="${escapeHtml(key)}" aria-expanded="${open}">
        <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(group.entries.map(entry => entry.name).join(', '))}</small><small>${escapeHtml(format(calories))} kcal${glTag}</small></span><span aria-hidden="true">${open ? '▴' : '▾'}</span></button>
      ${open ? `${renderEntryList(group.entries.map(entry => logged.get(entry.id) ?? entry), data, selectedDate)}${metrics ? `<button class="quiet-button" type="button" data-action="open-meal-details" data-meal-id="${escapeHtml(group.mealId)}">Meal details${metrics.glCompleteness === 'unknown' ? '' : `: ${escapeHtml(mealGlDisplay(metrics))}`}</button>` : '<p class="muted">Edit a food to choose its meal and see meal calculations.</p>'}` : ''}
    </article>`;
  }).join('');
}

function renderToday(data, state, ui = {}) {
  const selectedDate = state.selectedDate;
  const daily = dailySummary(selectedDate, data);
  const units = data.settings.units;
  const trainingDay = daily.trainingDay;
  const workouts = Array.isArray(data.dayState[selectedDate]?.workouts) ? data.dayState[selectedDate].workouts : [];
  const trainingControl = data.settings.trainingDayToggleEnabled
    ? `<button class="quiet-button" type="button" data-action="toggle-training" aria-pressed="${trainingDay}">${trainingDay ? 'Training day' : 'Rest day'}</button>`
    : '';
  const { pinned, problems, onTrack, water } = todayMetrics(daily, { dayProgress: ui.dayProgress ?? 1 });
  const bar = (metric, variant = '') => renderMetricBar(metric, { expanded: state.expandedMetric === metric.id, units, variant });
  const [calories, ...otherPinned] = pinned;
  const scheduled = data.library.some(item => isSupplementScheduled(item, selectedDate))
    || (data.dayState[selectedDate]?.supplementsCompleted ?? []).length > 0;
  const onTrackCount = onTrack.filter(metric => metric.level === 'good').length;
  const unknownCount = onTrack.length - onTrackCount;
  return `<section class="page today-page stack" aria-labelledby="today-title">
    <div class="today-heading"><div><span class="eyebrow">Selected day</span><h1 id="today-title">${escapeHtml(dateLabel(selectedDate))}</h1></div>${trainingControl}</div>
    ${workouts.length ? `<p class="workout-line"><span class="eyebrow">From Lift</span>${workouts.map(workout => `${escapeHtml(workout.name)}${Number.isFinite(workout.minutes) ? ` · ${escapeHtml(workout.minutes)} min` : ''}`).join('; ')}</p>` : ''}
    <form class="date-picker" data-action="select-date"><button class="quiet-button icon-button" type="button" data-action="shift-selected-date" data-days="-1" aria-label="Previous day">‹</button><label><span class="sr-only">Selected date</span><input name="selectedDate" type="date" value="${escapeHtml(selectedDate)}"></label><button class="quiet-button icon-button" type="button" data-action="shift-selected-date" data-days="1" aria-label="Next day">›</button></form>
    <section class="stack today-goals" aria-labelledby="goals-heading"><h2 id="goals-heading" class="sr-only">Calories, protein, and water</h2>
      ${calories ? bar(calories, 'hero') : ''}
      <div class="tile-pair">${otherPinned.map(metric => bar(metric, 'tile')).join('')}${water ? bar(water, 'tile') : ''}</div>
      ${water ? `<div class="water-actions"><button class="secondary-button" type="button" data-action="add-water" data-ml="${escapeHtml(data.settings.waterGlassMl)}">+${escapeHtml(formatWater(data.settings.waterGlassMl, units))}</button><button class="secondary-button" type="button" data-action="add-water" data-ml="${escapeHtml(data.settings.waterBottleMl)}">+${escapeHtml(formatWater(data.settings.waterBottleMl, units))}</button><button class="quiet-button" type="button" data-action="undo-water"${ui.canUndoWater ? '' : ' disabled'}>Undo water</button></div>` : ''}
      <p class="muted bar-hint">The line marks your target. Tap a bar to see what it means and which foods it came from.</p></section>
    <section class="stack today-problems" aria-labelledby="problems-heading"><h2 id="problems-heading">${problems.length ? 'Needs a look' : 'Nothing else is off target'}</h2>
      ${problems.length ? `<div class="metric-list">${problems.map(metric => bar(metric, 'tile')).join('')}</div>` : ''}
      <button class="on-track-toggle" type="button" data-action="toggle-on-track" aria-expanded="${state.onTrackOpen ? 'true' : 'false'}" aria-controls="on-track-list"><span>✓ ${escapeHtml(format(onTrackCount))} on track${unknownCount ? ` · ? ${escapeHtml(format(unknownCount))} unknown` : ''}</span><span class="on-track-dots" aria-hidden="true">${onTrack.filter(metric => metric.level === 'good').map(metric => `<i class="nutrient-${escapeHtml(nutrientKey(metric.id))}"></i>`).join('')}</span><strong>${state.onTrackOpen ? 'Hide' : 'Show'}</strong></button>
      ${state.onTrackOpen ? `<div id="on-track-list" class="metric-list">${onTrack.map(metric => bar(metric)).join('')}</div>` : ''}
    </section>
    <section class="card stack" aria-labelledby="today-log"><h2 id="today-log">Meals</h2>${renderMealGroups(daily.meals, data, selectedDate, state.openMeals ?? [])}
      <button class="primary-button full-width add-action" type="button" data-action="navigate" data-route="add">Add food or supplement</button></section>
    ${scheduled ? `<section class="card stack" aria-labelledby="today-supplements"><h2 id="today-supplements">Supplements</h2>${renderSupplementSchedule(data, selectedDate)}</section>` : ''}
    ${state.dialog?.kind === 'mealDetails' ? renderMealDetails(daily.meals.find(meal => meal.mealId === state.dialog.mealId)) : ''}
  </section>`;
}

function renderCoverage(data, state, date) {
  const weekly = weeklyCoverage(date, data);
  const trackedCoverage = data.settings.trackedNutrients.map(id => weekly.nutrients[id]).filter(Boolean);
  const dialogItem = state.dialog?.kind === 'nutrientDetails' ? weekly.nutrients[state.dialog.nutrientId] : null;
  const calorieCopy = weekly.calories.complete
    ? `<strong>${escapeHtml(format(Math.max(0, weekly.calories.remaining)))} kcal</strong> remain in the ${escapeHtml(format(weekly.calories.target))} kcal seven-day budget${weekly.calories.remaining < 0 ? `; ${escapeHtml(format(Math.abs(weekly.calories.remaining)))} kcal is above the reference` : ''}.`
    : `<strong>Seven-day budget remaining is unknown.</strong> At least ${escapeHtml(format(weekly.calories.total))} kcal is known.`;
  return `<section class="hero-card coverage-card" aria-labelledby="coverage-heading">
      <span class="eyebrow">${escapeHtml(dateLabel(weekly.startDate))} to ${escapeHtml(dateLabel(weekly.endDate))}</span>
      <h2 id="coverage-heading">Seven-day nutrient coverage</h2>
      <p class="weekly-budget">${calorieCopy}</p>
      <button class="coverage-toggle" type="button" data-action="toggle-coverage" aria-expanded="${state.coverageOpen ? 'true' : 'false'}" aria-controls="coverage-details"><span>${escapeHtml(coverageSummary(trackedCoverage))}</span><strong>${state.coverageOpen ? 'Hide details' : 'Show details'}</strong></button>
      ${state.coverageOpen ? `<div id="coverage-details"><p>Known amounts stay separate from gaps in food and supplement data.</p>
<div class="coverage-grid">${trackedCoverage.map(item => `<button class="coverage-item state-${escapeHtml(item.state)}" type="button" data-action="open-nutrient-details" data-nutrient-id="${escapeHtml(item.id)}" data-nutrient-origin="coverage"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(COVERAGE_LABELS[item.state])}</strong><small>${escapeHtml(formatNutrient(item.total, item.unit))}</small></button>`).join('')}</div></div>` : ''}
    </section>
    ${renderNutrientDetails(dialogItem)}`;
}

function renderLibrary({ data, state }) {
  const items = sortedLibrary(data.library, state.libraryQuery);
  return `<section class="page stack" aria-labelledby="library-title">
    <div class="page-heading"><div><span class="eyebrow">Saved for offline use</span><h1 id="library-title">Library</h1></div></div>
    <form class="card stack" data-action="search-library" role="search"><label>Search saved items<input type="search" name="query" value="${escapeHtml(state.libraryQuery)}" autocomplete="off"></label><button class="secondary-button" type="submit">Search</button></form>
    <button class="primary-button full-width" type="button" data-action="open-manual-entry">Create an item</button>
    <div class="stack">${items.length ? items.map(item => `<article class="card stack">
      <div><span class="eyebrow">${item.favorite ? 'Favorite · ' : ''}${escapeHtml(itemTypeLabel(item.type))}</span><h2>${escapeHtml(item.name)}</h2><p class="muted">${escapeHtml(item.servingLabel)}${item.type === 'supplement' ? ` · ${escapeHtml(scheduleLabel(item.schedule))}` : ''}</p></div>
      <div class="field-grid"><button class="primary-button" type="button" data-action="open-library-item" data-item-id="${escapeHtml(item.id)}">Review and add</button><button class="secondary-button" type="button" data-action="edit-library-item" data-item-id="${escapeHtml(item.id)}">Edit</button><button class="quiet-button" type="button" data-action="delete-library-item" data-item-id="${escapeHtml(item.id)}" aria-label="Delete ${escapeHtml(item.name)} from Library">Delete</button></div>
    </article>`).join('') : '<section class="card"><h2>No matching items</h2><p class="muted">Try another search or create a reusable item.</p></section>'}</div>
  </section>`;
}

// Shown while several semicolon-separated foods are being added one after another.
function renderQueueNote(state) {
  const queue = state.entryQueue;
  if (!queue) return '';
  const next = queue.remaining[0];
  return `<div class="stack queue-note"><p><strong>Item ${queue.position} of ${queue.total}.</strong>${next ? ` Next: ${escapeHtml(next)}` : ' This is the last one.'}</p>${next ? '<button class="quiet-button" type="button" data-action="skip-queued-item">Skip this item</button>' : ''}</div>`;
}

function renderAttachedPhotos(state) {
  const count = state.photoCount ?? 0;
  const note = state.photoNote ? `<p class="muted" role="status">${escapeHtml(state.photoNote)}</p>` : '';
  if (!count) return note;
  return `<div class="stack attached-photos"><p class="kept-photo">${count} photo${count === 1 ? '' : 's'} attached.</p><ul class="plain-list">${Array.from({ length: count }, (_, index) => `<li><span>Photo ${index + 1}</span><button class="quiet-button" type="button" data-action="remove-analysis-photo" data-photo-index="${index}" aria-label="Remove photo ${index + 1}">Remove</button></li>`).join('')}</ul>${note}</div>`;
}

function renderAdd({ data, state }) {
  const serviceName = analysisProvider(data.settings) === 'anthropic' ? 'Anthropic' : 'Google Gemini';
  // Items with no nutrition yet are kept out of one-tap adding.
  const recent = sortedLibrary(data.library).filter(item => item.type !== 'supplement' && hasKnownNutrition(item)).slice(0, 5);
  const analysis = state.analysis;
  const analysisContent = analysis?.status === 'loading'
    ? `<section class="card stack" role="status" aria-live="polite"><h2>${analysis.stage === 'reading-label' ? 'Reading the label' : 'Analyzing'}${state.entryQueue ? ` item ${state.entryQueue.position} of ${state.entryQueue.total}` : ''}</h2><p>${analysis.stage === 'reading-label'
      ? 'Checking the photo for a nutrition label, on your phone. No AI or internet is used. The first time takes longer while the reader downloads.'
      : `${analysis.hadPhoto ? 'No nutrition label was found in the photo, so ' : ''}${escapeHtml(serviceName)} is reading your entry and checking USDA records. This usually takes a few seconds, or up to 15 when Gemini is busy.`}</p><button class="secondary-button" type="button" data-action="cancel-analysis">Cancel</button></section>`
    : analysis?.status === 'needs_clarification'
      ? `<form class="card stack" data-action="answer-clarification"><h2>One quick question</h2>${renderQueueNote(state)}${analysis.questions.map(question => `<label>${escapeHtml(question.prompt)}${question.options?.length ? `<select name="${escapeHtml(question.id)}" required><option value="">Choose an ingredient</option>${question.options.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}</select>` : `<input name="${escapeHtml(question.id)}" required>`}</label>`).join('')}<button class="primary-button" type="submit">Continue</button><button class="secondary-button" type="button" data-action="edit-analysis-input">Edit what I typed</button><button class="quiet-button" type="button" data-action="cancel-analysis">Cancel</button></form>`
      : analysis?.status === 'error'
        ? `<section class="card stack" role="alert"><h2>Analysis could not finish</h2><p>${escapeHtml(analysis.error)}</p><form data-action="retry-analysis" class="stack"><button class="secondary-button" type="submit">Try again</button></form><button class="secondary-button" type="button" data-action="edit-analysis-input">Edit what I typed</button><button class="quiet-button" type="button" data-action="open-manual-entry">Enter nutrition manually</button><button class="quiet-button" type="button" data-action="cancel-analysis">Start over</button></section>`
        : `<form class="card stack" data-action="analyze-food"><h2>What did you eat?</h2><label><span class="sr-only">Describe what you ate</span><textarea name="text" rows="3" placeholder="2 vegan sausages, a cup of brown rice, and broccoli roasted in a little olive oil">${escapeHtml(state.addText ?? '')}</textarea></label>${renderAttachedPhotos(state)}<label>${state.photoCount ? 'Add another photo (optional)' : 'Photos of the meal or its nutrition label (optional, you can pick several)'}<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label><button class="primary-button" type="submit">Analyze</button><p class="muted">To add several foods, separate them with semicolons (like "oatmeal; banana; soy latte"). Each is reviewed in turn, and photos go with the first.</p><p class="muted">Numbers you type (like "30g protein") are used instead of what a photo or ${escapeHtml(serviceName)} shows. Photos are read on your phone first, and sent to ${escapeHtml(serviceName)} only when no label is found. Photos are not saved.</p></form>`;
  // Presets are open groups of plain buttons, never a dropdown or <details> (she could not find them in a dropdown,
  // 2026-10-07). They sit above the entry box unless an analysis is underway.
  const presets = `<section class="card stack" aria-labelledby="presets-heading"><h2 id="presets-heading">Presets</h2><p class="muted">Label values for Silk and Huel. Tap a group, then a product. You can set servings, like 0.5 for half a bottle, on the next screen.</p>${PRESET_GROUPS.map(group => {
    const open = state.presetGroup === group.id;
    return `<div class="stack preset-group"><button class="secondary-button full-width preset-toggle" type="button" data-action="toggle-preset-group" data-id="${escapeHtml(group.id)}" aria-expanded="${open}" aria-controls="preset-${escapeHtml(group.id)}"><span>${escapeHtml(group.label)}</span><span aria-hidden="true">${group.items.length} ${open ? '▴' : '▾'}</span></button>${open ? `<ul class="plain-list" id="preset-${escapeHtml(group.id)}">${group.items.map(item => `<li><span><strong>${escapeHtml(item.shortName)}</strong><small>${escapeHtml(item.servingLabel)} · ${escapeHtml(format(item.perServing.calories, 0))} kcal · ${escapeHtml(format(item.perServing.proteinG, 0))} g protein</small></span><button class="secondary-button" type="button" data-action="open-preset" data-id="${escapeHtml(item.id)}" aria-label="Review ${escapeHtml(item.name)}">Review</button></li>`).join('')}</ul>` : ''}</div>`;
  }).join('')}</section>`;
  const idle = !analysis || !['loading', 'needs_clarification', 'error'].includes(analysis.status);
  return `<section class="page stack" aria-labelledby="add-title">
    <div class="page-heading"><div><span class="eyebrow">${escapeHtml(dateLabel(state.selectedDate))}</span><h1 id="add-title">Add</h1></div></div>
    ${idle ? presets : ''}
    ${analysisContent}
    ${idle ? '' : presets}
    <section class="card stack" aria-labelledby="saved-heading"><h2 id="saved-heading">Favorites and recent items</h2>${recent.length ? `<ul class="plain-list">${recent.map(item => `<li><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.servingLabel)}</small></span><button class="secondary-button" type="button" data-action="open-library-item" data-item-id="${escapeHtml(item.id)}">Review</button></li>`).join('')}</ul>` : '<p class="muted">Your reusable items will appear here.</p>'}</section>
    <button class="quiet-button full-width" type="button" data-action="open-manual-entry">Enter nutrition manually</button>
  </section>`;
}

// The main numbers as plain boxes, always visible on the review. Their sources are under "Vitamins, minerals,
// and sources"; a changed number becomes her own entry.
// How much of a drink counts toward water, per serving: its own amount, or the drink rule on its analysis.
function fluidField(item, units) {
  const ml = Number.isFinite(item.fluidMl) ? item.fluidMl : drinkFluidMl(item.analysis?.estimate);
  const imperial = units === 'imperial';
  const shown = Number.isFinite(ml) && ml > 0 ? (imperial ? format(mlToFlOz(ml), 1) : String(Math.round(ml))) : '';
  return `<label class="macro-box">Counts as water (${imperial ? 'fl oz' : 'ml'})<input name="fluidAmount" type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(shown.replace(/,/g, ''))}" placeholder="Not a drink" aria-describedby="fluid-help"><small id="fluid-help">For drinks like soy milk or coffee, per serving. Leave blank for food.</small></label>`;
}

function macroBox(definition, item) {
  const value = nutrientValue(item.perServing ?? {}, definition);
  return `<label class="macro-box">${escapeHtml(definition.label)} (${escapeHtml(definition.unit)})<input name="nutrient_${escapeHtml(definition.key)}" type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(Number.isFinite(value) ? editableNumber(value) : '')}" placeholder="Unknown"></label>`;
}

const SUGAR_FIELDS = ['totalSugarG', 'addedSugarG', 'freeSugarG', 'intrinsicSugarG']
  .map(key => [...SOURCE_NUTRIENTS, ...NUTRIENTS].find(definition => definition.key === key));

// How a sugar value is known, in words: a label value, the person's own, a database value, derived by a food
// rule, an estimate (shown with ≈ and its range), or unknown.
function sugarEvidence(provenance) {
  if (!provenance) return 'Unknown';
  if (provenance.method === 'ingredient-estimate') return 'Estimated';
  if (['food-rule', 'difference'].includes(provenance.method)) return 'Derived';
  if (provenance.source === 'label') return 'Label value';
  if (provenance.source === 'manual') return 'Your value';
  if (['usda', 'usdaBranded', 'saved'].includes(provenance.source)) return 'Database value';
  return 'Estimated';
}

function sugarAmount(item, key) {
  const value = item.perServing?.[key];
  const provenance = item.provenance?.[key];
  if (!Number.isFinite(value)) return 'unknown';
  const range = provenance?.estimatedRange;
  return range ? `≈ ${formatNutrient(value, 'g')} (${formatNutrient(range.min, 'g')} to ${formatNutrient(range.max, 'g')})` : formatNutrient(value, 'g');
}

function sugarSummary(item) {
  const hasSugar = SUGAR_FIELDS.some(definition => Number.isFinite(item.perServing?.[definition.key])) || item.sugarIssues?.length;
  if (!hasSugar) return '';
  const free = item.provenance?.freeSugarG;
  const parts = [`${sugarAmount(item, 'totalSugarG')} total`,
    `${sugarAmount(item, 'freeSugarG')} free (${sugarEvidence(free)})`, `${sugarAmount(item, 'intrinsicSugarG')} intrinsic`];
  const issues = [
    item.sugarIssues?.includes('freeSugarAmountUnknown') ? 'Free sugar amount unknown: a sweetener is listed but no amount is printed.' : '',
    item.sugarIssues?.includes('sugarSumConflict') ? 'Free plus intrinsic sugar does not match total sugar; please review.' : '',
    item.ingredientEvidence?.partiallyHydrogenated ? 'Possible trans fat below label rounding threshold (partially hydrogenated oil).' : ''
  ].filter(Boolean);
  return `<p class="muted"><strong>Sugar:</strong> ${escapeHtml(parts.join(' · '))}</p>${issues.map(text => `<p class="form-status">${escapeHtml(text)}</p>`).join('')}`;
}

export const mealTypeLabel = type => MEAL_TYPES.find(option => option.id === type)?.label ?? 'Unassigned';
const clockTime = consumedAt => /T(\d{2}:\d{2})/.exec(String(consumedAt ?? ''))?.[1] ?? '';

// Which meal this food is part of: an existing meal on the selected day, or a new one.
function mealControls({ data, state, ui }) {
  const entries = data.log?.[state.selectedDate] ?? [];
  const draft = state.draft;
  const suggestion = draft.mode === 'logEdit' && draft.meal?.mealId
    ? draft.meal
    : suggestMealIdentity({ date: state.selectedDate, now: ui.now ?? new Date(), entries });
  const meals = groupMealEntries(entries.filter(entry => entry.id !== draft.entryId)).filter(group => group.mealId);
  const chosen = meals.some(group => group.mealId === suggestion.mealId) ? suggestion.mealId : 'new';
  return `<fieldset class="meal-controls stack"><legend>Meal</legend><div class="field-grid">
    <label>Part of<select name="mealId"><option value="new"${selected(chosen, 'new')}>A new meal</option>${meals.map(group => `<option value="${escapeHtml(group.mealId)}"${selected(chosen, group.mealId)}>${escapeHtml(`${mealTypeLabel(group.mealType)}${clockTime(group.consumedAt) ? ` at ${clockTime(group.consumedAt)}` : ''}`)}</option>`).join('')}</select></label>
    <label>Meal type<select name="mealType">${MEAL_TYPES.map(option => `<option value="${option.id}"${selected(suggestion.mealType ?? 'other', option.id)}>${escapeHtml(option.label)}</option>`).join('')}</select></label>
  </div></fieldset>`;
}

function glycemicReview(item) {
  const glycemic = item.glycemic;
  const per = { ...(item.perServing ?? {}), ...(item.perServing?.micros ?? {}) };
  const available = Number.isFinite(per.carbsG) && Number.isFinite(per.fiberG) ? Math.max(0, per.carbsG - per.fiberG) : null;
  if (!glycemic && !(available >= 1)) return '';
  const status = !glycemic ? 'No GI evidence yet, so GL is unknown.'
    : glycemic.leftUnknown ? 'GI left unknown by you.'
      : glycemic.completeness === 'unknown' ? 'No GI match for these foods, so GL is unknown.'
        : `${glycemic.completeness === 'partial' ? 'At least ' : ''}${one(glycemic.gl)} GL per serving${glycemic.range && glycemic.range.min !== glycemic.range.max ? ` (${one(glycemic.range.min)} to ${one(glycemic.range.max)})` : ''}, ${glycemic.confidence ?? 'low'} confidence${glycemic.manualGi ? `, from your GI of ${glycemic.manualGi.value}` : ''}.`;
  const matches = (glycemic?.components ?? []).filter(component => component.gi || component.material);
  return `<section class="stack glycemic-review" aria-labelledby="glycemic-review-title"><h2 id="glycemic-review-title">Glycemic estimate</h2>
    <p><strong>${escapeHtml(status)}</strong> ${Number.isFinite(available) ? `${escapeHtml(formatNutrient(available, 'g'))} available carbohydrate per serving.` : ''}</p>
    ${matches.length ? `<ul class="detail-list">${matches.map(component => `<li><span>${escapeHtml(component.name)}</span><span>${component.gi ? `GI ${escapeHtml(component.gi.value)} as ${escapeHtml(component.gi.referenceName ?? 'a match')} (${escapeHtml(component.gi.preparation ?? '')}; ${escapeHtml(component.gi.sourceName ?? '')})` : 'No GI match'}</span></li>`).join('')}</ul>` : ''}
    <div class="field-grid"><label>Glycemic index (0 to 100)<input name="manualGi" type="number" min="0" max="100" step="1" inputmode="numeric" value="${escapeHtml(glycemic?.manualGi?.value ?? '')}" placeholder="Use matched foods"></label>
    <label>GI source note<input name="manualGiSource" maxlength="200" value="${escapeHtml(glycemic?.manualGi?.sourceNote ?? '')}" placeholder="Where this GI came from"></label></div>
    <label class="choice inline-choice"><input name="leaveGiUnknown" type="checkbox"${checked(glycemic?.leftUnknown)}><span>Leave GI unknown</span></label>
    <p class="muted">GI is never required to log a food. GL is a planning estimate, not a prediction of your own glucose response.</p>
  </section>`;
}

function sugarReview(item) {
  const reasons = item.provenance?.freeSugarG?.reasons ?? [];
  return `<section class="stack sugar-review" aria-labelledby="sugar-review-title"><h2 id="sugar-review-title">Sugar breakdown</h2>
    <p class="muted">Free sugar is added sugar plus sugar in honey, syrups, juice, and smoothies. Sugar inside whole fruit, vegetables, and plain milk is intrinsic. Added sugar from the label is kept separately.</p>
    <label>Food classification<select name="classification">${FOOD_CLASSIFICATIONS.map(option => `<option value="${option.id}"${selected(item.classification ?? 'other', option.id)}>${escapeHtml(option.label)}</option>`).join('')}</select></label>
    <div class="field-grid">${SUGAR_FIELDS.map(definition => nutrientInput(definition, item)).join('')}</div>
    <p class="muted">Free sugar: ${escapeHtml(sugarEvidence(item.provenance?.freeSugarG))}${reasons.length ? `. ${escapeHtml(reasons.join('; '))}` : ''}</p>
    <label>Ingredient list<textarea name="ingredientsText" rows="4" placeholder="Paste or read the ingredient list">${escapeHtml(item.ingredientsText ?? '')}</textarea></label>
    <label>Ingredient-list photo<input name="ingredientImage" type="file" accept="image/jpeg,image/png,image/webp,image/heic"></label>
    <button class="secondary-button" type="button" data-action="read-ingredients">Read ingredient list</button>
  </section>`;
}

function nutrientInput(definition, item, { amount = true } = {}) {
  const value = nutrientValue(item.perServing ?? {}, definition);
  const provenance = item.provenance?.[definition.key] ?? {};
  const source = provenance.source ?? 'manual';
  const confidence = provenance.confidence ?? item.confidence ?? 'medium';
  const sourceDetails = [
    provenance.sourceIds?.length ? `Source IDs: ${provenance.sourceIds.join(', ')}` : provenance.sourceId ? `Source ID: ${provenance.sourceId}` : '',
    Number.isFinite(provenance.labelServingGrams) && Number.isFinite(provenance.trackedServingGrams)
      ? `Label basis: ${provenance.labelServingGrams} g to ${provenance.trackedServingGrams} g` : '',
    provenance.retrievedAt ? `Retrieved: ${provenance.retrievedAt}` : '',
    provenance.verifiedAt ? `Verified: ${provenance.verifiedAt}` : ''
  ].filter(Boolean).join(' · ');
  return `<fieldset class="stack"><legend>${escapeHtml(definition.label)} (${escapeHtml(definition.unit)})</legend>
    ${amount ? `<label>Amount per serving<input name="nutrient_${escapeHtml(definition.key)}" type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(Number.isFinite(value) ? editableNumber(value) : '')}" placeholder="Unknown"></label>` : ''}
    <div class="field-grid"><label>Source<select name="source_${escapeHtml(definition.key)}">${NUTRIENT_SOURCES.map(option => `<option value="${option.id}"${selected(source, option.id)}>${escapeHtml(option.label)}</option>`).join('')}</select></label><label>Confidence<select name="confidence_${escapeHtml(definition.key)}">${CONFIDENCE_LEVELS.map(option => `<option value="${option.id}"${selected(confidence, option.id)}>${escapeHtml(option.label)}</option>`).join('')}</select></label></div>
    ${sourceDetails ? `<small class="muted">${escapeHtml(sourceDetails)}</small>` : ''}
  </fieldset>`;
}

const hasKnownNutrition = item => REVIEW_NUTRIENTS.some(definition => Number.isFinite(nutrientValue(item.perServing ?? {}, definition)));

const scaledForDisplay = (value, factor) => typeof value === 'number' ? value * factor
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, scaledForDisplay(inner, factor)])) : value;

// The total for the servings being logged, shown under the servings question and updated as it changes.
export function servingsTotalText(perServing, servings) {
  const amount = Number(servings);
  if (!Number.isFinite(amount) || amount <= 0) return 'Enter how many servings you had.';
  return `You'll log: ${macroLine(scaledForDisplay(perServing ?? {}, amount))}`;
}

const SERVING_CHOICES = [[0.5, '½'], [1, '1'], [1.5, '1½'], [2, '2']];

function servingsQuestion(item, servings) {
  const packaged = item.type === 'packaged';
  const current = Number(servings ?? 1);
  return `<fieldset class="servings-question stack"><legend>${packaged ? 'How many servings did you have?' : 'Servings'}</legend>
    ${item.servingLabel ? `<p class="muted">1 serving = ${escapeHtml(item.servingLabel)}</p>` : ''}
    ${packaged ? `<div class="serving-choices">${SERVING_CHOICES.map(([value, label]) => `<button class="secondary-button" type="button" data-action="set-servings" data-servings="${value}" aria-pressed="${current === value}" aria-label="${value} serving${value === 1 ? '' : 's'}">${label}</button>`).join('')}</div>` : ''}
    <label>${packaged ? 'Or type an amount' : 'Servings'}<input name="servings" type="number" min="0.05" step="any" inputmode="decimal" value="${escapeHtml(servings ?? 1)}" required></label>
    <p class="muted" data-servings-total aria-live="polite">${escapeHtml(servingsTotalText(item.perServing, current))}</p>
  </fieldset>`;
}

export function macroLine(perServing = {}) {
  const parts = MACRO_NUTRIENTS.map(definition => {
    const value = nutrientValue(perServing, definition);
    const label = definition.key === 'calories' ? '' : ` ${definition.label.toLocaleLowerCase('en-US')}`;
    return Number.isFinite(value) ? `${formatNutrient(value, definition.unit)}${label}` : `${definition.label.toLocaleLowerCase('en-US')} unknown`;
  });
  return parts.join(' · ');
}

function sourceNote(item) {
  const sources = new Set(Object.values(item.provenance ?? {}).flatMap(record => record.contributors?.length
    ? record.contributors.map(contributor => contributor.source) : [record.source]));
  if (sources.has('usdaBranded')) sources.add('usda');
  const names = [['label', 'the product label'], ['usda', 'USDA records'], ['ai', 'AI estimates'],
    ['manual', 'your entries'], ['saved', 'saved items']].filter(([id]) => sources.has(id)).map(([, name]) => name);
  if (!names.length) return '';
  return `Based on ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]}.`;
}

function partialNote(item) {
  const partial = REVIEW_NUTRIENTS.filter(definition => item.provenance?.[definition.key]?.partial);
  if (!partial.length) return '';
  const missing = [...new Set(partial.flatMap(definition => item.provenance[definition.key].missingFrom ?? []))];
  return `Partly known${missing.length ? ` (no data for ${missing.join(', ')})` : ''}: ${partial.map(definition => definition.label).join(', ')}.`;
}

function renderConfirmation({ data, state, ui = {} }) {
  const draft = state.draft;
  const item = draft.item;
  const typeField = draft.mode === 'logEdit'
    ? `<label>Type<select disabled aria-describedby="log-type-help">${LIBRARY_ITEM_TYPES.map(option => `<option value="${option.id}"${selected(item.type, option.id)}>${escapeHtml(option.label)}</option>`).join('')}</select><input type="hidden" name="type" value="${escapeHtml(draft.lockedType ?? item.type)}"><small id="log-type-help">Item type is fixed while editing an existing log entry.</small></label>`
    : `<label>Type<select name="type">${LIBRARY_ITEM_TYPES.map(option => `<option value="${option.id}"${selected(item.type, option.id)}>${escapeHtml(option.label)}</option>`).join('')}</select></label>`;
  const tracked = data.settings.trackedNutrients
    .map(id => NUTRIENTS.find(nutrient => nutrient.id === id))
    .filter(Boolean)
    .filter(nutrient => !MACRO_NUTRIENTS.some(macro => macro.key === nutrient.key))
    .filter(nutrient => nutrient.key !== 'freeSugarG');
  const assumptions = Array.isArray(item.assumptions) ? item.assumptions.join('\n') : '';
  const components = Array.isArray(item.components)
    ? item.components.map(component => typeof component === 'string' ? component : component.name).filter(Boolean).join('\n')
    : '';
  const analysisReview = draft.analysisReview;
  const moreOpen = draft.moreNutrientsOpen ?? (draft.mode === 'manual' || !hasKnownNutrition(item));
  const labelBasisText = analysisReview?.labelBasis
    ? `<p><strong>Label serving basis${analysisReview.labelBasis.componentName ? ` for ${escapeHtml(analysisReview.labelBasis.componentName)}` : ''}:</strong> ${escapeHtml(analysisReview.labelBasis.printedServingGrams)} g printed label serving to ${escapeHtml(editableNumber(analysisReview.labelBasis.trackedServingGrams))} g tracked serving of that ingredient (${escapeHtml(Number(analysisReview.labelBasis.scaleFactor.toPrecision(4)))}× label values).</p>`
    : '';
  const recipeReview = analysisReview ? `<section class="stack" aria-labelledby="analysis-review-title"><h2 id="analysis-review-title">Calculation review</h2><p>${item.type === 'recipe' ? `Recipe total for ${escapeHtml(analysisReview.totalServings)} servings from these ingredients:` : 'Analyzed components:'}</p><ul class="review-list">${analysisReview.components.map((component, index) => `<li>${escapeHtml(component.name)} ${escapeHtml(editableNumber(component.grams))} g from ${analysisReview.labelBasis?.componentIndex === index ? 'Product label + ' : ''}${escapeHtml(component.source)}</li>`).join('')}</ul>${labelBasisText}${item.type === 'recipe' ? `<div class="field-grid"><div><strong>Total recipe</strong><p>${escapeHtml(nutrientSummary(analysisReview.recipeTotal))}</p></div><div><strong>Per serving</strong><p>${escapeHtml(nutrientSummary(item.perServing))}</p></div></div>` : ''}</section>` : '';
  return `<section class="page stack" aria-labelledby="confirmation-title">
    <div class="page-heading"><div><span class="eyebrow">Review before saving</span><h1 id="confirmation-title">Confirm nutrition</h1></div><button class="quiet-button" type="button" data-action="close-confirmation">Close</button></div>
    ${renderQueueNote(state)}
    <form class="stack" data-action="confirm-item">
      <section class="card stack review-summary">
        <label>Name<input name="name" required value="${escapeHtml(item.name ?? '')}"></label>
        <label>Day<input name="logDate" type="date" required value="${escapeHtml(state.selectedDate)}"></label>
        ${item.type === 'supplement' ? `<label>Servings<input name="servings" type="number" min="0.25" step="0.25" inputmode="decimal" value="${escapeHtml(draft.servings ?? 1)}" required></label>` : servingsQuestion(item, draft.servings)}
        ${hasKnownNutrition(item) || draft.mode === 'manual' ? '' : '<p class="form-status is-error" role="alert">This item has no nutrition yet. Enter its label values below, or analyze a photo of its label, before adding it.</p>'}
        ${draft.analysisReview?.usdaProblems?.length ? `<p class="form-status is-error" role="alert">USDA could not be reached for ${escapeHtml(draft.analysisReview.usdaProblems.map(item => item.name).join(', '))} (${escapeHtml(draft.analysisReview.usdaProblems[0].error)}), so their vitamins and minerals are AI estimates. A free USDA key in Settings avoids this, or analyze a photo of the label.</p>` : ''}
        <section class="stack" aria-labelledby="nutrition-facts-title"><h2 id="nutrition-facts-title">Nutrition facts per serving</h2><p class="muted">Change any number that looks wrong. A number you change is saved as your own entry.</p><div class="macro-grid">${MACRO_NUTRIENTS.map(definition => macroBox(definition, item)).join('')}</div></section>
        ${item.type === 'supplement' ? '' : fluidField(item, data.settings.units)}
        <p class="review-totals"><strong>Per serving:</strong> <span data-review-totals>${escapeHtml(macroLine(item.perServing))}</span></p>
        ${sourceNote(item) ? `<p class="muted">${escapeHtml(sourceNote(item))}</p>` : ''}
        ${partialNote(item) ? `<p class="muted">${escapeHtml(partialNote(item))}</p>` : ''}
        ${item.type === 'supplement' ? '' : sugarSummary(item)}
        ${item.type === 'supplement' ? '' : mealControls({ data, state, ui })}
        ${item.type === 'supplement' ? '' : `<label class="choice inline-choice"><input type="checkbox" name="favorite"${checked(item.favorite)}><span>Save as a favorite for next time</span></label>`}
        ${formNotice(ui, 'confirm-item')}
        ${draft.mode === 'analysis' ? '<button class="secondary-button full-width" type="button" data-action="edit-analysis-input">Edit what I typed</button>' : ''}
              <div class="stack">${item.type === 'supplement'
        ? `<button class="primary-button full-width" type="submit" name="intent" value="complete" data-day-button>Mark complete for ${escapeHtml(dateLabel(state.selectedDate))}</button>`
        : `<button class="primary-button full-width" type="submit" name="intent" value="log" data-day-button>${draft.mode === 'logEdit' ? 'Save changes to' : 'Add to'} ${escapeHtml(dateLabel(state.selectedDate))}</button>`}<button class="secondary-button full-width" type="submit" name="intent" value="save">Save to Library</button></div>
      </section>
      <section class="card stack">
        <button class="secondary-button full-width" type="button" data-action="toggle-more-nutrients" aria-expanded="${moreOpen}" aria-controls="more-nutrients">Vitamins, minerals, and sources</button>
        <div class="stack" id="more-nutrients" data-region="more-nutrients"${moreOpen ? '' : ' hidden'}>
          <section class="stack"><h2>Tracked nutrients per serving</h2><p class="muted">Leave an unknown value blank. It will not be counted as zero.</p><div class="field-grid">${tracked.map(definition => nutrientInput(definition, item)).join('')}</div></section>
          <section class="stack"><h2>Sources for the main numbers</h2><div class="field-grid">${MACRO_NUTRIENTS.map(definition => nutrientInput(definition, item, { amount: false })).join('')}</div></section>
        </div>
      </section>
      <details class="card stack review-details"${draft.mode === 'manual' || !hasKnownNutrition(item) ? ' open' : ''}>
        <summary>More details</summary>
        ${recipeReview}
        <input type="hidden" name="itemId" value="${escapeHtml(item.id ?? '')}">
        <div class="field-grid">${typeField}<label>Household serving label<input name="servingLabel" required value="${escapeHtml(item.servingLabel ?? '')}" placeholder="1 bowl, 1 tablet, 2 scoops"></label></div>
        ${item.type === 'supplement' ? '' : sugarReview(item)}
        ${item.type === 'supplement' ? '' : glycemicReview(item)}
      <section class="stack"><h2>Details and evidence</h2>
        <label>Ingredient or component breakdown<textarea name="components" rows="4" placeholder="One component per line">${escapeHtml(components)}</textarea></label>
        <label>Assumptions<textarea name="assumptions" rows="3" placeholder="One assumption per line">${escapeHtml(assumptions)}</textarea></label>
      </section>
${item.type === 'supplement' ? `<section class="stack"><h2>Supplement schedule</h2><p class="muted">For supplements, enter exact label amounts above and choose when you plan to take this product.</p><label>Frequency<select name="scheduleFrequency"><option value="daily"${selected(item.schedule?.frequency, 'daily')}>Daily</option><option value="weekly"${selected(item.schedule?.frequency, 'weekly')}>Weekly</option><option value="custom"${selected(item.schedule?.frequency, 'custom')}>Custom days</option></select></label><fieldset><legend>Scheduled days</legend><div class="check-grid">${WEEKDAYS.map((day, index) => `<label class="choice inline-choice"><input type="checkbox" name="scheduleDays" value="${index}"${checked(item.schedule?.days?.includes(index))}><span>${day}</span></label>`).join('')}</div></fieldset></section>` : ''}
      </details>
    </form>
  </section>`;
}

function renderPlaceholder(route) {
  const descriptions = {
    add: 'Choose a saved item, manual entry, label, recipe, supplement, or description.',
    library: 'Reusable meals, recipes, packaged foods, and supplements will live here.',
    progress: 'Weekly weight and nutrient patterns will appear here after you add data.'
  };
  return `<section class="page empty-page" aria-labelledby="route-title"><span class="eyebrow">Workspace</span><h1 id="route-title">${routeTitle(route)}</h1><p>${descriptions[route] ?? ''}</p></section>`;
}

function chartValue(value, units, kind) {
  if (kind === 'weight') return units === 'imperial' ? kgToLb(value) : value;
  return units === 'imperial' ? cmToIn(value) : value;
}

function renderTrendChart(points, units, kind) {
  const isWeight = kind === 'weight';
  const available = points.filter(point => Number.isFinite(isWeight ? point.weightKg : point.waistCm));
  if (!available.length) return '<p class="muted">Add readings to see this trend.</p>';
  const raw = available.map(point => chartValue(isWeight ? point.weightKg : point.waistCm, units, kind));
  const smooth = isWeight ? available.map(point => Number.isFinite(point.trendKg)
    ? chartValue(point.trendKg, units, kind) : null) : [];
  const values = [...raw, ...smooth.filter(Number.isFinite)];
  const min = Math.min(...values) - 0.5;
  const max = Math.max(...values) + 0.5;
  const firstDay = Date.parse(`${available[0].date}T00:00:00Z`);
  const lastDay = Date.parse(`${available.at(-1).date}T00:00:00Z`);
  const x = date => lastDay === firstDay ? 124
    : 30 + (Date.parse(`${date}T00:00:00Z`) - firstDay) / (lastDay - firstDay) * 188;
  const y = value => 170 - (value - min) / (max - min) * 120;
  const path = (series, selected) => selected.map((point, index) => `${index ? 'L' : 'M'} ${x(point.date).toFixed(1)} ${y(series[index]).toFixed(1)}`).join(' ');
  const smoothPoints = isWeight ? available.filter(point => Number.isFinite(point.trendKg)) : [];
  const smoothValues = smoothPoints.map(point => chartValue(point.trendKg, units, kind));
  const unit = isWeight ? (units === 'imperial' ? 'lb' : 'kg') : (units === 'imperial' ? 'in' : 'cm');
  const captionUnit = !isWeight && units === 'imperial' ? 'inches' : unit;
  const rawLast = available.at(-1);
  const rawLabel = isWeight ? 'Raw' : 'Waist';
  return `<figure class="trend-figure">
    <svg class="trend-chart" viewBox="0 0 320 210" role="img" aria-hidden="true" focusable="false">
      <line class="chart-axis" x1="30" y1="170" x2="218" y2="170"/>
      <text class="chart-tick" x="25" y="50" text-anchor="end">${format(max, 1)}</text>
      <text class="chart-tick" x="25" y="173" text-anchor="end">${format(min, 1)}</text>
      ${available.length > 1 ? `<path class="chart-raw" d="${path(raw, available)}"/>` : ''}
      ${available.map((point, index) => `<circle class="chart-point" cx="${x(point.date).toFixed(1)}" cy="${y(raw[index]).toFixed(1)}" r="3"/>`).join('')}
      ${smoothPoints.length > 1 ? `<path class="chart-rolling" d="${path(smoothValues, smoothPoints)}"/>` : ''}
      <path class="chart-guide chart-guide-raw" d="M ${x(rawLast.date).toFixed(1)} ${y(raw.at(-1)).toFixed(1)} L 226 29"/>
      <text class="chart-direct-label" x="232" y="32">${rawLabel}</text>
      ${smoothPoints.length ? `<path class="chart-guide chart-guide-rolling" d="M ${x(smoothPoints.at(-1).date).toFixed(1)} ${y(smoothValues.at(-1)).toFixed(1)} L 226 51"/>
      <text class="chart-direct-label" x="232" y="54">7-day mean</text>` : ''}
      <text class="chart-tick" x="30" y="193">${escapeHtml(available[0].date.slice(5))}</text>
      <text class="chart-tick" x="218" y="193" text-anchor="end">${escapeHtml(rawLast.date.slice(5))}</text>
    </svg>
    <figcaption>${isWeight ? 'Weight' : 'Waist'} in ${captionUnit}, from ${escapeHtml(available[0].date)} to ${escapeHtml(rawLast.date)}. ${isWeight ? 'The 7-day mean appears when two readings fall within seven days.' : 'Optional waist readings are shown only when recorded.'}</figcaption>
    <div class="sr-only"><table><caption>${isWeight ? 'Weight' : 'Waist'} readings and trend in ${captionUnit}</caption><thead><tr><th scope="col">Date</th><th scope="col">Reading</th>${isWeight ? '<th scope="col">7-day mean</th>' : ''}</tr></thead><tbody>
      ${available.map(point => `<tr><th scope="row">${escapeHtml(point.date)}</th><td>${format(chartValue(isWeight ? point.weightKg : point.waistCm, units, kind), 1)}</td>${isWeight ? `<td>${Number.isFinite(point.trendKg) ? format(chartValue(point.trendKg, units, kind), 1) : 'Insufficient readings'}</td>` : ''}</tr>`).join('')}
    </tbody></table></div>
  </figure>`;
}

function renderPeriodSummary(summary, tracked) {
  const evidence = (metric, suffix) => metric.average === null
    ? 'Insufficient complete days'
    : `${format(metric.average, 1)} ${suffix} across ${metric.completeDays} complete of ${metric.loggedDays} logged days`;
  const nutrients = ['protein', 'fiber', ...tracked.filter(id => id !== 'protein' && id !== 'fiber')]
    .filter(id => summary.nutrients[id]);
  return `<section class="card stack" aria-label="${summary.periodDays}-day nutrition">
    <h2>${summary.periodDays}-day nutrition</h2>
    <p class="muted">Averages use complete evidence only. Unlogged days and unknown item values are not counted as zero.</p>
    <div class="metric-grid"><article><span>Calories per complete day</span><strong>${evidence(summary.calories, 'kcal')}</strong></article>
    <article><span>Protein per complete day</span><strong>${evidence(summary.protein, 'g')}</strong></article></div>
    <p class="compact-copy">Protein target met on ${summary.protein.metDays} of ${summary.protein.completeDays} complete protein days.</p>
    <div><h3>Nutrient coverage</h3><ul class="coverage-summary-list">${nutrients.map(id => {
      const nutrient = summary.nutrients[id];
      return `<li><span>${escapeHtml(nutrient.label)}</span><span>${nutrient.completeDays
        ? `${nutrient.metDays} of ${nutrient.completeDays} complete days met${nutrient.highDays ? `; ${nutrient.highDays} ${nutrient.highDays === 1 ? 'day' : 'days'} above reference` : ''}${nutrient.inProgressDays ? `; ${nutrient.inProgressDays} in progress` : ''}`
        : 'No complete days'}<small>${nutrient.completeDays} of ${nutrient.loggedDays} logged days have complete evidence</small></span></li>`;
    }).join('')}</ul></div>
    ${renderCardiometabolicPeriod(summary.cardiometabolic)}
  </section>`;
}

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function periodEvidence(metric, within = metric.withinDays) {
  return metric.completeDays
    ? `${within} of ${plural(metric.completeDays, 'complete day')} within target; ${metric.completeDays} of ${plural(metric.loggedDays, 'logged day')} ${metric.completeDays === 1 ? 'has' : 'have'} complete evidence`
    : `No complete days; 0 of ${plural(metric.loggedDays, 'logged day')} have complete evidence`;
}

function renderCardiometabolicPeriod(cardio) {
  if (!cardio || !cardio.freeSugar.loggedDays) return '';
  const meals = cardio.meals;
  const glCounts = [['high', 'high'], ['possiblyHigh', 'possibly high'], ['moderate', 'moderate'], ['low', 'low'], ['partial', 'partly known'], ['unknown', 'unknown']]
    .filter(([key]) => meals[key]).map(([key, label]) => `${meals[key]} ${label}`);
  return `<div class="stack"><h3>Heart and glucose</h3><ul class="coverage-summary-list">
    <li><span>Free sugar: ${escapeHtml(periodEvidence(cardio.freeSugar))}</span></li>
    <li><span>Fiber: minimum met on ${cardio.fiber.minimumDays} and preferred on ${cardio.fiber.preferredDays} of ${plural(cardio.fiber.loggedDays, 'logged day')}</span></li>
    <li><span>Saturated fat: ${escapeHtml(periodEvidence(cardio.saturatedFat))}</span></li>
    <li><span>Trans fat: ${cardio.transFat.declaredZeroDays} with 0 g declared, ${cardio.transFat.attentionDays} with an ingredient warning, ${cardio.transFat.positiveDays} with trans fat, of ${plural(cardio.transFat.loggedDays, 'logged day')}</span></li>
    <li><span>Sodium: within the ideal limit on ${cardio.sodium.idealDays} and within the maximum on ${cardio.sodium.hardDays} of ${plural(cardio.sodium.completeDays, 'complete day')} (${plural(cardio.sodium.loggedDays, 'logged day')})</span></li>
    <li><span>Meals by estimated GL: ${meals.total ? escapeHtml(glCounts.join(', ')) : 'no assigned meals'}</span></li>
    <li><span>Refined-heavy meals: ${meals.refinedHeavy} of ${meals.withRatio} with a fiber ratio</span></li>
  </ul></div>`;
}

export function renderProgress({ data, state, ui = {} }) {
  const units = data.settings.units;
  const imperial = units === 'imperial';
  const entries = [...data.bodyMetrics].sort((a, b) => a.date.localeCompare(b.date));
  const current = entries.find(entry => entry.date === state.editingBodyMetricDate);
  const series = rollingWeightSeries(entries);
  const waistSeries = series.filter(point => Number.isFinite(point.waistCm));
  const date = current?.date ?? state.progressDate ?? state.selectedDate;
  const weightValue = current ? chartValue(current.weightKg, units, 'weight') : '';
  const waistValue = current?.waistCm === undefined ? '' : chartValue(current.waistCm, units, 'waist');
  const summaries = [7, 30].map(period => progressSummary(state.progressDate ?? state.selectedDate, data, period));
  const pending = data.recommendations.filter(item => item.status === 'pending');
  const history = data.recommendations.filter(item => ['accepted', 'dismissed', 'superseded'].includes(item.status)).reverse();
  return `<section class="page progress-page" aria-labelledby="progress-title">
    <div class="page-heading"><div><span class="eyebrow">Your patterns</span><h1 id="progress-title">Progress</h1></div></div>
    <form class="card stack" data-action="save-body-metric">
      <div><h2>${current ? 'Edit reading' : 'Add a reading'}</h2><p class="muted">One reading per local date. Weight is required; waist is optional.</p></div>
      <div class="field-grid"><label>Date<input name="date" type="date" value="${escapeHtml(date)}" required${current ? ' readonly' : ''}></label>
      <label>Weight (${imperial ? 'lb' : 'kg'})<input name="weight" type="number" min="${imperial ? format(kgToLb(25) - 0.000001, 6) : 25}" max="${imperial ? format(kgToLb(400) + 0.000001, 6) : 400}" step="${imperial ? 'any' : '0.01'}" inputmode="decimal" value="${weightValue === '' ? '' : format(weightValue, imperial ? 6 : 2)}" required></label>
      <label>Waist (${imperial ? 'in' : 'cm'}), optional<input name="waist" type="number" min="${imperial ? format(cmToIn(20) - 0.000001, 6) : 20}" max="${imperial ? format(cmToIn(300) + 0.000001, 6) : 300}" step="${imperial ? 'any' : '0.01'}" inputmode="decimal" value="${waistValue === '' ? '' : format(waistValue, imperial ? 6 : 2)}"></label></div>
      <input type="hidden" name="units" value="${escapeHtml(units)}">
      ${formNotice(ui, 'save-body-metric')}
      <div class="progress-actions"><button class="primary-button" type="submit">${current ? 'Save changes' : 'Save reading'}</button>${current ? '<button class="quiet-button" type="button" data-action="cancel-body-metric-edit">Cancel edit</button>' : ''}</div>
    </form>
    <section class="card stack" aria-labelledby="weight-heading"><div><h2 id="weight-heading">Weight trend</h2><p class="muted">Individual readings and the trailing 7-day mean. There is no fixed goal line.</p></div>${renderTrendChart(series, units, 'weight')}</section>
    ${waistSeries.length ? `<section class="card stack" aria-labelledby="waist-heading"><h2 id="waist-heading">Waist trend</h2>${renderTrendChart(waistSeries, units, 'waist')}</section>` : ''}
    <section class="card stack" aria-labelledby="readings-heading"><h2 id="readings-heading">Readings</h2>${entries.length ? `<ul class="plain-list reading-list">${entries.slice().reverse().map(entry => `<li><span><strong>${escapeHtml(entry.date)}</strong><small>${format(chartValue(entry.weightKg, units, 'weight'), 1)} ${imperial ? 'lb' : 'kg'}${Number.isFinite(entry.waistCm) ? ` · waist ${format(chartValue(entry.waistCm, units, 'waist'), 1)} ${imperial ? 'in' : 'cm'}` : ''}</small></span><span class="reading-actions"><button class="quiet-button" type="button" data-action="edit-body-metric" data-date="${escapeHtml(entry.date)}" aria-label="Edit reading for ${escapeHtml(entry.date)}">Edit</button><button class="quiet-button" type="button" data-action="delete-body-metric" data-date="${escapeHtml(entry.date)}" aria-label="Delete reading for ${escapeHtml(entry.date)}">Delete</button></span></li>`).join('')}</ul>` : '<p class="muted">No readings yet.</p>'}</section>
    ${renderCoverage(data, state, state.progressDate ?? state.selectedDate)}
    ${summaries.map(summary => renderPeriodSummary(summary, data.settings.trackedNutrients)).join('')}
    <section class="card stack" aria-labelledby="recommendations-heading"><div><h2 id="recommendations-heading">Target recommendations</h2><p class="muted">Suggestions require consistent readings across two 14-day windows. Your targets change only when you accept.</p></div>
      <button class="secondary-button" type="button" data-action="refresh-progress">Check current trend</button>
      ${pending.length ? pending.map(item => `<article class="recommendation-card"><h3>Pending suggestion</h3><p>${item.changeCalories > 0 ? 'Increase' : 'Reduce'} your average by ${format(Math.abs(item.changeCalories))} kcal per day.</p><p class="muted">Observed trend: ${Number.isFinite(item.observedPercentPerWeek) ? `${format(item.observedPercentPerWeek, 2)}% weight loss per week` : 'Trend recorded'}. Basis: ${escapeHtml(item.basis?.startDate ?? 'unknown')} to ${escapeHtml(item.basis?.endDate ?? 'unknown')}.</p><div class="progress-actions"><button class="primary-button" type="button" data-action="accept-recommendation" data-id="${escapeHtml(item.id)}">Accept suggestion</button><button class="quiet-button" type="button" data-action="dismiss-recommendation" data-id="${escapeHtml(item.id)}">Dismiss</button></div></article>`).join('') : '<p class="muted">No pending suggestions.</p>'}
      <h3>Recommendation history</h3>${history.length ? `<ul class="plain-list decision-list">${history.map(item => `<li><span><strong>${item.status === 'accepted' ? 'Accepted' : item.status === 'dismissed' ? 'Dismissed' : 'Outdated after readings changed'} ${item.changeCalories > 0 ? '+' : ''}${format(item.changeCalories)} kcal</strong><small>${escapeHtml(item.acceptedAt ?? item.dismissedAt ?? item.supersededAt ?? item.createdAt ?? 'Date unavailable')}${item.status === 'accepted' && Number.isFinite(item.appliedChangeCalories) ? ` · ${item.appliedChangeCalories > 0 ? '+' : ''}${format(item.appliedChangeCalories)} kcal applied` : ''}</small></span></li>`).join('')}</ul>` : '<p class="muted">No decisions yet.</p>'}
    </section>
  </section>`;
}

function nutrientChecks(tracked) {
  return NUTRIENTS.map(nutrient => `<label class="check-row"><input type="checkbox" name="trackedNutrients" value="${nutrient.id}"${checked(tracked.includes(nutrient.id))}><span><strong>${escapeHtml(nutrient.label)}</strong><small>${escapeHtml(nutrient.evidence)}</small></span></label>`).join('');
}

const HEART_TARGET_INPUTS = [
  ['freeSugarMaxG', 'Free sugar maximum (g)', 0, 500, 1],
  ['fiberMinG', 'Fiber minimum (g)', 0, 100, 1],
  ['fiberPreferredG', 'Preferred fiber (g)', 0, 150, 1],
  ['saturatedFatPercentMax', 'Saturated fat (% of calories)', 0, 10, 0.5],
  ['transFatMaxG', 'Trans fat (g)', 0, 0, 1],
  ['sodiumIdealMaxMg', 'Ideal sodium limit (mg)', 0, 10000, 50],
  ['sodiumHardMaxMg', 'Sodium maximum (mg)', 0, 10000, 50],
  ['fiberCarbRatioDenominatorMax', 'Refined-heavy below 1 g fiber per (g carbohydrate)', 1, 50, 1],
  ['carbsPercentMin', 'Carbs: lowest % of calories', 0, 100, 1],
  ['carbsPercentMax', 'Carbs: highest % of calories', 0, 100, 1],
  ['fatPercentMin', 'Fat: lowest % of calories', 0, 100, 1],
  ['fatPercentMax', 'Fat: highest % of calories', 0, 100, 1],
  ['mealCarbsMaxG', 'Carbs per meal, most (g)', 10, 200, 1],
  ['mealGlMax', 'Estimated GL per meal, most', 1, 100, 1],
  ['dailyGlMax', 'Estimated GL per day, most', 10, 400, 5],
  ['solubleFiberMinG', 'Soluble fiber minimum (g)', 0, 50, 1],
  ['solubleFiberPreferredG', 'Preferred soluble fiber (g)', 0, 50, 1]
];

function renderHeartTargets(targets, ui) {
  const reference = { ...CARDIOMETABOLIC_TARGET_DEFAULTS, ...(targets.computed ?? {}) };
  const overrides = targets.overrides ?? {};
  return `<form class="card stack" data-action="save-heart-targets">
    <div><h2>Heart and glucose targets</h2><p class="muted">Editable planning references, not medical advice. 1,500 mg is the ideal sodium limit and 2,300 mg the maximum. During the day saturated fat shows a gram budget from your calorie target; the final percentage uses the calories you actually logged. Carb and fat ranges are shares of each day's calorie target, set for prediabetes: moderate carbs spread across meals, and fat mostly from nuts, seeds, avocado, and olive oil.</p></div>
    <div class="field-grid">${HEART_TARGET_INPUTS.map(([key, label, min, max, step]) => `<label>${escapeHtml(label)}<input name="${key}" type="number" min="${min}" max="${max}" step="${step}" inputmode="decimal" value="${escapeHtml(overrides[key] ?? '')}" placeholder="${escapeHtml(format(reference[key], 1))}"${min === max ? ' readonly' : ''}>${Number.isFinite(overrides[key]) ? `<button class="text-button" type="button" data-action="reset-target-field" data-field="${key}">Use default (${escapeHtml(format(CARDIOMETABOLIC_TARGET_DEFAULTS[key], 1))})</button>` : ''}</label>`).join('')}</div>
    <div class="button-row"><button class="quiet-button" type="button" data-action="set-saturated-fat-preset" data-value="6">Heart-focused 6%</button><button class="quiet-button" type="button" data-action="set-saturated-fat-preset" data-value="10">General 10%</button></div>
    ${formNotice(ui, 'save-heart-targets')}<button class="secondary-button" type="submit">Save heart and glucose targets</button>
  </form>`;
}

export function renderSettings({ data, ui = {} }) {
  const { profile, settings, targets, library, meta } = data;
  const provider = analysisProvider(settings);
  const waterGlass = settings.units === 'imperial' ? mlToFlOz(settings.waterGlassMl) : settings.waterGlassMl;
  const waterBottle = settings.units === 'imperial' ? mlToFlOz(settings.waterBottleMl) : settings.waterBottleMl;
  const waterUnit = settings.units === 'imperial' ? 'fl oz' : 'ml';
  const supplements = library.filter(item => item.type === 'supplement');
  return `<section class="page settings-page" aria-labelledby="settings-title">
    <div class="page-heading"><div><span class="eyebrow">Make it yours</span><h1 id="settings-title">Settings</h1></div></div>
    <form class="card stack" data-action="save-profile">
      <div><h2>Profile and activity</h2><p class="muted">Canonical values remain metric when display units change.</p></div>
      ${renderProfileFields(profile, settings.units, 'settings')}
      <fieldset><legend>Pace</legend>${renderPaceOptions(profile.pace)}</fieldset>
      ${formNotice(ui, 'save-profile')}<button class="secondary-button" type="submit">Save profile</button>
    </form>
    <form class="card stack" data-action="save-target-overrides">
      <div><h2>Targets</h2><p class="muted"><strong>Calculated reference</strong> stays visible while overrides change your effective targets.</p></div>
      ${renderTargetCards(targets.computed)}
      <div class="field-grid">
        <label>Calorie override<input name="averageCalories" type="number" min="${targets.computed?.bmr ?? 0}" step="25" value="${escapeHtml(targets.overrides?.averageCalories ?? '')}" placeholder="Use calculated"></label>
        <label>Protein override (g)<input name="proteinG" type="number" min="0" step="5" value="${escapeHtml(targets.overrides?.proteinG ?? '')}" placeholder="Use calculated"></label>
      </div>
      ${formNotice(ui, 'save-target-overrides')}<button class="secondary-button" type="submit">Save target overrides</button>
    </form>
    ${renderHeartTargets(targets, ui)}
    <form class="card stack" data-action="set-units">
      <div><h2>Display units</h2><p class="muted">This changes display and entry fields only.</p></div>
      <label>Units<select name="units"><option value="imperial"${selected(settings.units, 'imperial')}>US units</option><option value="metric"${selected(settings.units, 'metric')}>Metric</option></select></label>
      ${formNotice(ui, 'set-units')}<button class="secondary-button" type="submit">Save units</button>
    </form>
    <form class="card stack" data-action="save-tracked-nutrients">
      <div><h2>Tracked nutrients</h2><p class="muted">Unknown values remain unknown when a label or source omits them.</p></div>
      <div class="check-grid">${nutrientChecks(settings.trackedNutrients)}</div>
      ${formNotice(ui, 'save-tracked-nutrients')}<button class="secondary-button" type="submit">Save nutrient list</button>
    </form>
    <section class="card stack" aria-labelledby="supplement-schedules"><div><h2 id="supplement-schedules">Supplement schedules</h2><p class="muted">Schedules are tracked separately from food.</p></div>${supplements.length ? `<ul class="plain-list">${supplements.map(item => `<li><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.schedule?.frequency ?? 'No schedule')}</span></li>`).join('')}</ul>` : '<p>No supplements saved yet.</p>'}<button class="secondary-button" type="button" data-action="navigate" data-route="library">Open library</button></section>
    <form class="card stack" data-action="save-training-behavior"><div><h2>Training behavior</h2><p class="muted">Training-day calories stay within the weekly budget.</p><p class="muted">${meta.activitySyncedAt ? `Workouts from Lift last synced ${escapeHtml(new Date(meta.activitySyncedAt).toLocaleString('en-US', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}. Days with a Lift workout become training days unless you set the day yourself.` : 'Workouts from Lift have not synced yet. Days with a Lift workout become training days automatically.'}</p></div><label class="choice inline-choice"><input type="checkbox" name="trainingDayToggleEnabled"${checked(settings.trainingDayToggleEnabled)}><span>Show the training-day toggle</span></label>${formNotice(ui, 'save-training-behavior')}<button class="secondary-button" type="submit">Save training behavior</button></form>
    <form class="card stack" data-action="save-water-increments"><div><h2>Water increments</h2></div><div class="field-grid"><label>Glass (${waterUnit})<input name="waterGlass" type="number" min="1" step="0.1" value="${format(waterGlass, settings.units === 'imperial' ? 1 : 0)}"></label><label>Bottle (${waterUnit})<input name="waterBottle" type="number" min="1" step="0.1" value="${format(waterBottle, settings.units === 'imperial' ? 1 : 0)}"></label></div><input type="hidden" name="units" value="${settings.units}">${formNotice(ui, 'save-water-increments')}<button class="secondary-button" type="submit">Save water buttons</button></form>
    <form class="card stack" data-action="save-integrations"><div><h2>Analysis integrations</h2><p class="muted">Photo, label, recipe, and description analysis needs one AI key. Saved items, manual entry, and USDA search work without it. Keys are saved only in this browser and are left out of ordinary exports.</p></div>
      <label>AI service<select name="provider"><option value="gemini"${selected(provider, 'gemini')}>Google Gemini (free tier)</option><option value="anthropic"${selected(provider, 'anthropic')}>Anthropic Claude (paid)</option></select></label>
      <p class="muted">On Gemini's free tier, Google may use the descriptions and photos you submit for analysis to improve its products, and people may review them. Only what you submit for analysis is sent; your tracker history is not.</p>
      <ul class="evidence-list"><li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">Get a free Gemini API key</a></li></ul>
      <label>Gemini API key<input name="geminiApiKey" type="password" autocomplete="off" value="${escapeHtml(settings.geminiApiKey)}"></label>
      <label>Gemini model<input name="geminiModel" type="text" value="${escapeHtml(settings.geminiModel || 'gemini-3.8-flash')}"></label>
      <p class="muted">USDA lookups supply vitamins and minerals. Without your own free USDA key they share a demo key limited to about 30 lookups an hour.</p>
      <ul class="evidence-list"><li><a href="https://api.data.gov/signup/" target="_blank" rel="noreferrer">Get a free USDA FoodData Central key (name and email only)</a></li></ul>
      <label>USDA FoodData Central key<input name="foodDataCentralApiKey" type="password" autocomplete="off" value="${escapeHtml(settings.foodDataCentralApiKey)}"></label>
      <details class="stack"><summary>Anthropic (optional, paid)</summary>
        <label>Anthropic API key<input name="anthropicApiKey" type="password" autocomplete="off" value="${escapeHtml(settings.anthropicApiKey)}"></label>
        <label>Claude model<input name="model" type="text" value="${escapeHtml(settings.model)}"></label>
        <ul class="evidence-list"><li><a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Create an Anthropic API key</a></li></ul>
      </details>
      ${formNotice(ui, 'save-integrations')}<button class="secondary-button" type="submit">Save integrations</button></form>
    <form class="card stack" data-action="save-cloud"><div><h2>Cloud backup</h2><p class="muted">Backs up your history to a private GitHub repository after every change, restores it on a new phone, and picks up entries added for you there. The app keeps working offline. Your token is saved only on this device and is never included in backups or exports.</p></div>
      <p data-region="cloud-status" role="status"><strong>${escapeHtml(ui.cloudStatus || (settings.cloudToken ? 'Waiting to sync.' : 'Not connected yet.'))}</strong></p>
      <ul class="evidence-list"><li><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create a GitHub token for the backup repository</a></li></ul>
      <label>Repository<input name="cloudRepo" type="text" autocomplete="off" value="${escapeHtml(settings.cloudRepo || 'shreyavikram/longevity-diet-data')}"></label>
      <label>GitHub token<input name="cloudToken" type="password" autocomplete="off" value="${escapeHtml(settings.cloudToken)}"></label>
      ${formNotice(ui, 'save-cloud')}<button class="secondary-button" type="submit">Save and sync</button>${settings.cloudToken ? '<button class="quiet-button" type="button" data-action="sync-cloud">Sync now</button>' : ''}</form>
    <section class="card stack" aria-labelledby="install-heading"><h2 id="install-heading">Install and offline use</h2><div class="stack" data-region="install-status">${renderInstallStatus(ui)}</div></section>
    <section class="card stack" aria-labelledby="data-heading"><h2 id="data-heading">Export and import</h2><p><strong>${meta.lastExportAt ? `Last export: ${escapeHtml(new Date(meta.lastExportAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}` : 'No export saved from this device yet.'}</strong> Your history lives only in this browser, so export regularly and keep the file somewhere safe.</p><p class="muted">Downloads contain your local tracker history. By default, API keys are excluded. Files you save may be readable by others with access to them.</p><form class="stack" data-action="export-data"><label class="choice inline-choice"><input name="includeSecrets" type="checkbox"><span>Include API keys in export</span></label><p class="muted">Warning: including API keys exposes them to anyone who can open the downloaded file. You will be asked to confirm.</p><button class="secondary-button" type="submit">Download export</button></form><form class="stack" data-action="import-data"><label>Choose JSON export<input name="file" type="file" accept=".json,application/json" required></label><label class="choice inline-choice"><input name="includeSecrets" type="checkbox"><span>Include API keys from import</span></label><p class="muted">Import replaces local tracker data. Imported API keys are excluded unless you choose to include them and confirm.</p><button class="secondary-button" type="submit">Import file</button></form>${ui.dataStatus ? `<p role="status">${escapeHtml(ui.dataStatus)}</p>` : ''}</section>
    <section class="card stack" aria-labelledby="evidence-notes"><div><h2 id="evidence-notes">Evidence notes</h2><p class="muted">Targets distinguish RDAs, AIs, limits, and evidence-informed ranges.</p></div><ul class="evidence-list">${NUTRIENTS.filter(item => item.citation).map(item => `<li><a href="${escapeHtml(item.citation)}" target="_blank" rel="noreferrer">${escapeHtml(item.label)}: ${escapeHtml(item.evidence)}</a></li>`).join('')}</ul></section>
    <section class="card stack danger-zone" aria-labelledby="erase-heading"><div><h2 id="erase-heading">Erase local data</h2><p class="muted">Removes all tracker history from this browser and starts over from your default profile. Download an export first if you may want it back.</p></div><form class="inline-form" data-action="reset-data"><label>Type RESET ALL DATA<input name="confirmation" autocomplete="off"></label><button class="danger-button" type="submit">Erase local data</button></form>${formNotice(ui, 'reset-data')}</section>
    <section class="card disclaimer-card" aria-labelledby="disclaimer-heading"><h2 id="disclaimer-heading">Disclaimer</h2><p>${DISCLAIMER}</p></section>
  </section>`;
}

function renderGlobalNotices(ui, showDataStatus) {
  const alert = ui.notice?.tone === 'error' && !FORMS_WITH_NOTICES.has(ui.notice.form)
    ? `<p class="global-status is-error" role="alert">${escapeHtml(ui.notice.text)}</p>` : '';
  const dataStatus = showDataStatus && ui.dataStatus ? `<p class="global-status" role="status">${escapeHtml(ui.dataStatus)}</p>` : '';
  return `<div data-region="update-banner" role="status">${renderUpdateBanner(ui)}</div>${alert}${dataStatus}`;
}

export function renderApp({ state, data, computedTargets = data.targets.computed, effectiveTargets = resolveEffectiveTargets(data.targets), ui = {} }) {
  const content = state.draft?.kind === 'confirmation'
    ? renderConfirmation({ data, state, ui })
    : state.route === 'settings'
    ? renderSettings({ data, ui })
    : state.route === 'today'
      ? renderToday(data, state, ui)
      : state.route === 'library'
        ? renderLibrary({ data, state })
        : state.route === 'add'
          ? renderAdd({ data, state })
          : state.route === 'progress'
            ? renderProgress({ data, state, ui })
            : renderPlaceholder(state.route);
  return `<a class="skip-link" href="#main-content">Skip to content</a>
    <header class="app-header"><div class="brand-mark" aria-hidden="true">L</div><span>Longevity</span><span class="local-badge">Saved locally</span></header>
    ${renderGlobalNotices(ui, state.route !== 'settings')}
    <main id="main-content">${content}</main>
    ${renderNav(state.route)}
    <div class="sr-only" role="status" aria-live="polite" id="app-status"></div>`;
}

export { DISCLAIMER };
