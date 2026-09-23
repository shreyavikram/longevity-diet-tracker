import {
  CONFIDENCE_LEVELS,
  LIBRARY_ITEM_TYPES,
  MACRO_NUTRIENTS,
  NUTRIENTS,
  NUTRIENT_SOURCES,
  WEEKDAYS
} from './constants.js';
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

const dateLabel = date => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
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
const FORMS_WITH_NOTICES = new Set(['save-profile', 'save-target-overrides', 'set-units', 'save-tracked-nutrients',
  'save-training-behavior', 'save-water-increments', 'save-integrations', 'save-body-metric', 'confirm-item', 'reset-data']);

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

export function renderOnboarding({ data, computedTargets, draft = null }) {
  const { settings } = data;
  const profile = draft?.profile ?? data.profile;
  const units = draft?.units ?? settings.units;
  const usesSupplements = draft?.usesSupplements ?? settings.usesSupplements ?? false;
  const overrides = draft?.overrides ?? data.targets.overrides ?? {};
  const acknowledgeDisclaimer = draft?.acknowledgeDisclaimer ?? false;
  return `<main id="main-content" class="page onboarding-page">
    <div class="welcome">
      <span class="eyebrow">Set up your private tracker</span>
      <h1>Build a useful starting point</h1>
      <p>Your saved tracker data stays on this device. Analysis content you choose to submit goes directly to your configured Anthropic and USDA services.</p>
    </div>
    <section class="card stack" aria-labelledby="restore-heading"><h2 id="restore-heading">Moving from another device?</h2><p class="muted">Restore a JSON export from Settings on your other device instead of starting fresh. API keys are not restored here; add them again in Settings.</p><form class="stack" data-action="import-data"><label>Choose JSON export<input name="file" type="file" accept=".json,application/json" required></label><button class="secondary-button" type="submit">Restore backup</button></form></section>
    <form class="stack" data-action="complete-onboarding">
      <section class="card step-card" aria-labelledby="setup-profile">
        <div class="step-number" aria-hidden="true">1</div>
        <div><h2 id="setup-profile">Personal profile</h2><p class="muted">Values are stored in metric units for consistent calculations.</p></div>
        ${renderProfileFields(profile, units, 'onboarding', { showPreferences: true })}
      </section>
      <section class="card step-card" aria-labelledby="setup-pace">
        <div class="step-number" aria-hidden="true">2</div>
        <div><h2 id="setup-pace">Choose a pace</h2><p class="muted">Your moderate starting pace is preselected.</p></div>
        ${renderPaceOptions(profile.pace)}
      </section>
      <section class="card step-card" aria-labelledby="setup-targets">
        <div class="step-number" aria-hidden="true">3</div>
        <div><h2 id="setup-targets">Review calculated targets</h2><p class="muted">Training calories are redistributed within the weekly budget.</p></div>
        <div data-region="onboarding-targets" aria-live="polite">${renderTargetCards(computedTargets)}</div>
        <fieldset class="stack"><legend>Optional manual overrides</legend><p class="muted">Leave fields blank to use the calculated reference above.</p><div class="field-grid">
          <label>Calorie override<input name="averageCalories" type="number" min="${computedTargets?.bmr ?? 0}" step="25" value="${escapeHtml(overrides.averageCalories ?? '')}" placeholder="Use calculated"></label>
          <label>Protein override (g)<input name="proteinG" type="number" min="0" step="5" value="${escapeHtml(overrides.proteinG ?? '')}" placeholder="Use calculated"></label>
        </div></fieldset>
      </section>
      <section class="card step-card" aria-labelledby="setup-supplements">
        <div class="step-number" aria-hidden="true">4</div>
        <div><h2 id="setup-supplements">Supplements</h2><p class="muted">Add exact products and label amounts later. The app will never invent a dose.</p></div>
        <label class="choice inline-choice"><input type="checkbox" name="usesSupplements"${checked(usesSupplements)}> <span>I use one or more supplements</span></label>
      </section>
      <section class="card step-card" aria-labelledby="setup-huel">
        <div class="step-number" aria-hidden="true">5</div>
        <div><h2 id="setup-huel">Starter Huel categories</h2><p class="muted">We will add editable Black Edition-style smoothie and Hot &amp; Savory placeholders. They stay unverified until you enter a current package label.</p></div>
      </section>
      <section class="card step-card" aria-labelledby="setup-disclaimer">
        <div class="step-number" aria-hidden="true">6</div>
        <div><h2 id="setup-disclaimer">One important note</h2><p>${DISCLAIMER}</p></div>
        <label class="choice inline-choice"><input type="checkbox" name="acknowledgeDisclaimer" required${checked(acknowledgeDisclaimer)}> <span>I understand and want to continue</span></label>
      </section>
      <button class="primary-button full-width" type="submit">Start tracking</button>
    </form>
  </main>`;
}

function renderLogEntries(data, selectedDate) {
  const entries = data.log[selectedDate] ?? [];
  if (!entries.length) return '<p class="muted">No meals logged for this date yet.</p>';
  return `<ul class="plain-list">${entries.map(entry => `<li><span><strong>${escapeHtml(entry.name)}</strong><small>${format(entry.servings, 2)} × ${escapeHtml(entry.servingLabel)}</small></span><span>
    <button class="quiet-button" type="button" data-action="edit-log-entry" data-entry-id="${escapeHtml(entry.id)}">Edit</button>
    <button class="quiet-button" type="button" data-action="delete-log-entry" data-entry-id="${escapeHtml(entry.id)}" aria-label="Delete ${escapeHtml(entry.name)} from ${escapeHtml(dateLabel(selectedDate))}">Delete</button>
  </span></li>`).join('')}</ul>`;
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
    ? `<p class="detail-label">Unknown in:</p><ul class="unknown-list">${item.unknownItems.map(entry => `<li>${escapeHtml(entry.name)} <small>${escapeHtml(dateLabel(entry.date))}${entry.reason === 'missingHistoricalSnapshot' ? ' · Historical label snapshot unavailable' : ''}</small></li>`).join('')}</ul>`
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

function renderToday(data, state, ui = {}) {
  const selectedDate = state.selectedDate;
  const daily = dailySummary(selectedDate, data);
  const weekly = weeklyCoverage(selectedDate, data);
  const trainingDay = daily.trainingDay;
  const workouts = Array.isArray(data.dayState[selectedDate]?.workouts) ? data.dayState[selectedDate].workouts : [];
  const trainingControl = data.settings.trainingDayToggleEnabled
    ? `<button class="quiet-button" type="button" data-action="toggle-training" aria-pressed="${trainingDay}">${trainingDay ? 'Training day' : 'Rest day'}</button>`
    : '';
  const trackedCoverage = data.settings.trackedNutrients
    .map(id => weekly.nutrients[id])
    .filter(Boolean);
  const needsAttention = weekly.needsAttention
    .filter(item => data.settings.trackedNutrients.includes(item.id));
  const dueSupplements = data.library.filter(item => isSupplementScheduled(item, selectedDate));
  const completed = new Set(data.dayState[selectedDate]?.supplementsCompleted ?? []);
  const incompleteSupplements = dueSupplements.filter(item => !completed.has(item.id));
  const protein = daily.details.protein;
  const fiber = daily.details.fiber;
  const calories = daily.calories.knownTotal;
  const targetCalories = daily.targets?.calories ?? 0;
  const remaining = daily.remainingCalories;
  const macros = [
    ['Fiber', fiber.total, 'g', fiber.target],
    ['Carbohydrate', daily.nutrients.carbsG, 'g', null],
    ['Fat', daily.nutrients.fatG, 'g', null]
  ];
  const dialogItem = state.dialog?.kind === 'nutrientDetails'
    ? weekly.nutrients[state.dialog.nutrientId]
    : null;
  const dailyCalorieCopy = daily.calories.complete
    ? `<span>Calories remaining</span><strong>${escapeHtml(format(Math.abs(remaining)))} kcal</strong><small>${remaining >= 0 ? `${escapeHtml(format(calories))} of ${escapeHtml(format(targetCalories))} kcal target` : `${escapeHtml(format(Math.abs(remaining)))} kcal above the day reference`}</small>`
    : `<span>Calories</span><strong>At least ${escapeHtml(format(calories))} kcal known</strong><small>Remaining calories unknown. Calories are unknown for: ${daily.calories.unknownItems.map(item => escapeHtml(item.name)).join(', ')}.</small>`;
  const weeklyCalorieCopy = weekly.calories.complete
    ? `<strong>${escapeHtml(format(Math.max(0, weekly.calories.remaining)))} kcal</strong> remain in the ${escapeHtml(format(weekly.calories.target))} kcal seven-day budget${weekly.calories.remaining < 0 ? `; ${escapeHtml(format(Math.abs(weekly.calories.remaining)))} kcal is above the reference` : ''}.`
    : `<strong>Seven-day budget remaining is unknown.</strong> At least ${escapeHtml(format(weekly.calories.total))} kcal is known. Calories are unknown for: ${weekly.calories.unknownItems.map(item => escapeHtml(item.name)).join(', ')}.`;
  return `<section class="page today-page stack" aria-labelledby="today-title">
    <div class="today-heading"><div><span class="eyebrow">Selected day</span><h1 id="today-title">${escapeHtml(dateLabel(selectedDate))}</h1></div>${trainingControl}</div>
    ${workouts.length ? `<p class="workout-line"><span class="eyebrow">From Lift</span>${workouts.map(workout => `${escapeHtml(workout.name)}${Number.isFinite(workout.minutes) ? ` · ${escapeHtml(workout.minutes)} min` : ''}`).join('; ')}</p>` : ''}
    <form class="date-picker" data-action="select-date"><button class="quiet-button icon-button" type="button" data-action="shift-selected-date" data-days="-1" aria-label="Previous day">‹</button><label><span class="sr-only">Selected date</span><input name="selectedDate" type="date" value="${escapeHtml(selectedDate)}"></label><button class="quiet-button icon-button" type="button" data-action="shift-selected-date" data-days="1" aria-label="Next day">›</button></form>
    <section class="card" aria-labelledby="protein-calories-heading"><h2 id="protein-calories-heading">Protein and calories</h2><div class="primary-metrics"><article><span>Protein</span><strong>${escapeHtml(formatNutrient(protein.total, 'g'))}</strong><small>of ${escapeHtml(formatNutrient(protein.target, 'g'))}</small></article><article>${dailyCalorieCopy}</article></div><p class="weekly-budget">${weeklyCalorieCopy} The effective weekly average is ${escapeHtml(format(daily.targets?.averageCalories ?? 0))} kcal.</p></section>
    <section class="card stack" aria-labelledby="secondary-metrics-heading"><h2 id="secondary-metrics-heading">Fiber, water, and macros</h2><div class="metric-grid">${macros.map(([label, value, unit, target]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(formatNutrient(value, unit))}</strong>${Number.isFinite(target) ? `<small>of ${escapeHtml(formatNutrient(target, unit))}</small>` : '<small>from known values</small>'}</article>`).join('')}<article><span>Water</span><strong>${escapeHtml(formatWater(daily.waterMl, data.settings.units))} logged</strong><small>of ${escapeHtml(formatWater(daily.targets?.waterMl ?? 0, data.settings.units))}</small></article></div><div class="water-actions"><button class="secondary-button" type="button" data-action="add-water" data-ml="${escapeHtml(data.settings.waterGlassMl)}">+${escapeHtml(formatWater(data.settings.waterGlassMl, data.settings.units))}</button><button class="secondary-button" type="button" data-action="add-water" data-ml="${escapeHtml(data.settings.waterBottleMl)}">+${escapeHtml(formatWater(data.settings.waterBottleMl, data.settings.units))}</button><button class="quiet-button" type="button" data-action="undo-water"${ui.canUndoWater ? '' : ' disabled'}>Undo water</button></div></section>
    <section class="card stack" aria-labelledby="today-log"><h2 id="today-log">Logged meals</h2>${renderLogEntries(data, selectedDate)}</section>
    <button class="primary-button full-width add-action" type="button" data-action="navigate" data-route="add">Add food or supplement</button>
    <section class="card stack" aria-labelledby="today-supplements"><h2 id="today-supplements">Scheduled supplements</h2>${renderSupplementSchedule(data, selectedDate)}</section>
    <section class="card attention-card" aria-labelledby="attention-heading"><h2 id="attention-heading">Needs attention</h2>${incompleteSupplements.length || needsAttention.length ? `<ol class="attention-list">${incompleteSupplements.map(item => `<li><strong>Scheduled today:</strong> ${escapeHtml(item.name)} has not been marked complete.</li>`).join('')}${needsAttention.map(item => `<li><button class="text-button" type="button" data-action="open-nutrient-details" data-nutrient-id="${escapeHtml(item.id)}" data-nutrient-origin="attention"><strong>${escapeHtml(item.label)}</strong>: ${escapeHtml(COVERAGE_LABELS[item.state])}</button></li>`).join('')}</ol>` : '<p class="muted">No tracked nutrient or scheduled supplement needs attention in this view.</p>'}</section>
    <section class="hero-card coverage-card" aria-labelledby="coverage-heading">
      <span class="eyebrow">${escapeHtml(dateLabel(weekly.startDate))} to ${escapeHtml(dateLabel(weekly.endDate))}</span>
      <h2 id="coverage-heading">Seven-day nutrient coverage</h2>
      <button class="coverage-toggle" type="button" data-action="toggle-coverage" aria-expanded="${state.coverageOpen ? 'true' : 'false'}" aria-controls="coverage-details"><span>${escapeHtml(coverageSummary(trackedCoverage))}</span><strong>${state.coverageOpen ? 'Hide details' : 'Show details'}</strong></button>
      ${state.coverageOpen ? `<div id="coverage-details"><p>Known amounts stay separate from gaps in food and supplement data.</p>
<div class="coverage-grid">${trackedCoverage.map(item => `<button class="coverage-item state-${escapeHtml(item.state)}" type="button" data-action="open-nutrient-details" data-nutrient-id="${escapeHtml(item.id)}" data-nutrient-origin="coverage"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(COVERAGE_LABELS[item.state])}</strong><small>${escapeHtml(formatNutrient(item.total, item.unit))}</small></button>`).join('')}</div></div>` : ''}
    </section>
    ${renderNutrientDetails(dialogItem)}
  </section>`;
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

function renderAdd({ data, state }) {
  const recent = sortedLibrary(data.library).filter(item => item.type !== 'supplement').slice(0, 5);
  const analysis = state.analysis;
  const analysisContent = analysis?.status === 'loading'
    ? `<section class="card stack" role="status" aria-live="polite"><h2>Analyzing food</h2><p>Checking the description and food records. You can cancel at any time.</p><button class="secondary-button" type="button" data-action="cancel-analysis">Cancel analysis</button></section>`
    : analysis?.status === 'needs_clarification'
      ? `<form class="card stack" data-action="answer-clarification"><h2>A few details would help</h2><p class="muted">Only questions that may change the estimate are shown.</p>${analysis.questions.map(question => `<label>${escapeHtml(question.prompt)}${question.options?.length ? `<select name="${escapeHtml(question.id)}" required><option value="">Choose an ingredient</option>${question.options.map(option => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join('')}</select>` : `<input name="${escapeHtml(question.id)}" required>`}</label>`).join('')}${['foodPhoto', 'labelPhoto'].includes(analysis.kind) ? '<label>Reselect the photo for this request<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required></label><p class="muted">Photos are cleared after each request.</p>' : ''}<button class="primary-button" type="submit">Continue analysis</button><button class="secondary-button" type="button" data-action="cancel-analysis">Cancel</button></form>`
      : analysis?.status === 'candidates'
        ? `<form class="card stack" data-action="select-analysis-candidates"><h2>Choose food records</h2><p class="muted">Check each ingredient against the USDA description. Similar results need your choice.</p>${analysis.error ? `<p role="alert">${escapeHtml(analysis.error)}</p>` : ''}${analysis.draft.components.map((component, index) => `<fieldset class="stack"><legend>${escapeHtml(component.name)} · ${escapeHtml(component.householdAmount)} (${escapeHtml(component.estimatedGrams)} g)</legend>${component.candidates.length ? component.candidates.map(food => `<label class="choice inline-choice"><input type="radio" name="candidate_${index}" value="${escapeHtml(food.fdcId)}"${checked(food.fdcId === component.selectedFdcId)}><span>${escapeHtml(food.description)} <small>${escapeHtml(food.dataType)}${food.brand ? ` · ${escapeHtml(food.brand)}` : ''} · ${food.basis === 'perServing' ? `per ${escapeHtml(food.servingSize)} ${escapeHtml(food.servingSizeUnit ?? 'serving')}` : 'per 100 g'} · FDC ${escapeHtml(food.fdcId)}</small></span></label>`).join('') : `<p role="status">${component.lookupError ? escapeHtml(component.lookupError) : 'No USDA match found.'} Its nutrients will remain unknown unless you enter a label or manual value during review.</p>`}</fieldset>`).join('')}${analysis.draft.components.some(component => !component.candidates.length) ? '<button class="secondary-button" type="button" data-action="retry-usda">Retry USDA search</button>' : ''}<button class="primary-button" type="submit">Review nutrition</button><button class="secondary-button" type="button" data-action="cancel-analysis">Cancel</button></form>`
        : analysis?.status === 'error'
          ? `<section class="card stack" role="alert"><h2>Analysis could not finish</h2><p>${escapeHtml(analysis.error)}</p><form data-action="retry-analysis" class="stack">${['foodPhoto', 'labelPhoto'].includes(analysis.kind) ? '<label>Reselect the photo<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required></label>' : ''}<button class="secondary-button" type="submit">Try again</button></form><button class="quiet-button" type="button" data-action="cancel-analysis">Back to Add</button></section>`
          : `<form class="card stack" data-action="analyze-food"><h2>Analyze a food or recipe</h2><label>Input type<select name="kind"><option value="description">Meal description</option><option value="recipe">Recipe</option><option value="foodPhoto">Food photo</option><option value="labelPhoto">Nutrition label photo</option></select></label><label>Description, ingredients, or package name<textarea name="text" rows="4" placeholder="What did you eat? Include amounts when known."></textarea></label><label>Photo for food or label analysis<input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></label><p class="muted">Analysis content goes directly to Anthropic and USDA from this browser. Anthropic receives the description or photo; USDA receives food search terms. API keys stay in this browser's settings, and photos are used only for the active request.</p><button class="primary-button" type="submit">Analyze food</button></form>`;
  return `<section class="page stack" aria-labelledby="add-title">
    <div class="page-heading"><div><span class="eyebrow">${escapeHtml(dateLabel(state.selectedDate))}</span><h1 id="add-title">Add</h1></div></div>
    <section class="hero-card"><span class="eyebrow">Works offline</span><h2>Log what you know</h2><p>Use a saved item or enter label and nutrition details manually. Unknown nutrients stay unknown.</p></section>
    <section class="card stack" aria-labelledby="saved-heading"><h2 id="saved-heading">Favorites and recent items</h2>${recent.length ? `<ul class="plain-list">${recent.map(item => `<li><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.servingLabel)}</small></span><button class="secondary-button" type="button" data-action="open-library-item" data-item-id="${escapeHtml(item.id)}">Review</button></li>`).join('')}</ul>` : '<p class="muted">Your reusable items will appear here.</p>'}</section>
    <button class="primary-button full-width" type="button" data-action="open-manual-entry">Enter nutrition manually</button>
    ${analysisContent}
    <section class="card stack" aria-labelledby="scheduled-heading"><h2 id="scheduled-heading">Scheduled supplements</h2>${renderSupplementSchedule(data, state.selectedDate)}</section>
    <section class="card stack" aria-labelledby="selected-log"><h2 id="selected-log">Entries for ${escapeHtml(dateLabel(state.selectedDate))}</h2>${renderLogEntries(data, state.selectedDate)}</section>
  </section>`;
}

function nutrientInput(definition, item) {
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
    <label>Amount per serving<input name="nutrient_${escapeHtml(definition.key)}" type="number" min="0" step="any" inputmode="decimal" value="${escapeHtml(Number.isFinite(value) ? editableNumber(value) : '')}" placeholder="Unknown"></label>
    <div class="field-grid"><label>Source<select name="source_${escapeHtml(definition.key)}">${NUTRIENT_SOURCES.map(option => `<option value="${option.id}"${selected(source, option.id)}>${escapeHtml(option.label)}</option>`).join('')}</select></label><label>Confidence<select name="confidence_${escapeHtml(definition.key)}">${CONFIDENCE_LEVELS.map(option => `<option value="${option.id}"${selected(confidence, option.id)}>${escapeHtml(option.label)}</option>`).join('')}</select></label></div>
    ${sourceDetails ? `<small class="muted">${escapeHtml(sourceDetails)}</small>` : ''}
  </fieldset>`;
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
    .filter(nutrient => !MACRO_NUTRIENTS.some(macro => macro.key === nutrient.key));
  const assumptions = Array.isArray(item.assumptions) ? item.assumptions.join('\n') : '';
  const components = Array.isArray(item.components)
    ? item.components.map(component => typeof component === 'string' ? component : component.name).filter(Boolean).join('\n')
    : '';
  const analysisReview = draft.analysisReview;
  const labelBasisText = analysisReview?.labelBasis
    ? `<p><strong>Label serving basis${analysisReview.labelBasis.componentName ? ` for ${escapeHtml(analysisReview.labelBasis.componentName)}` : ''}:</strong> ${escapeHtml(analysisReview.labelBasis.printedServingGrams)} g printed label serving to ${escapeHtml(editableNumber(analysisReview.labelBasis.trackedServingGrams))} g tracked serving of that ingredient (${escapeHtml(Number(analysisReview.labelBasis.scaleFactor.toPrecision(4)))}× label values).</p>`
    : '';
  const recipeReview = analysisReview ? `<section class="card stack" aria-labelledby="analysis-review-title"><h2 id="analysis-review-title">Calculation review</h2><p>${item.type === 'recipe' ? `Recipe total for ${escapeHtml(analysisReview.totalServings)} servings from these ingredients:` : 'Analyzed components:'}</p><ul class="review-list">${analysisReview.components.map((component, index) => `<li>${escapeHtml(component.name)} ${escapeHtml(editableNumber(component.grams))} g from ${analysisReview.labelBasis?.componentIndex === index ? 'Product label + ' : ''}${escapeHtml(component.source)}</li>`).join('')}</ul>${labelBasisText}${item.type === 'recipe' ? `<div class="field-grid"><div><strong>Total recipe</strong><p>${escapeHtml(nutrientSummary(analysisReview.recipeTotal))}</p></div><div><strong>Per serving</strong><p>${escapeHtml(nutrientSummary(item.perServing))}</p></div></div>` : ''}</section>` : '';
  return `<section class="page stack" aria-labelledby="confirmation-title">
    <div class="page-heading"><div><span class="eyebrow">Review before saving</span><h1 id="confirmation-title">Confirm nutrition</h1></div><button class="quiet-button" type="button" data-action="close-confirmation">Close</button></div>
    <form class="stack" data-action="confirm-item">
      ${recipeReview}
      <input type="hidden" name="itemId" value="${escapeHtml(item.id ?? '')}">
      <section class="card stack"><h2>Item and serving</h2><div class="field-grid">
        <label>Name<input name="name" required value="${escapeHtml(item.name ?? '')}"></label>
        ${typeField}
        <label>Household serving label<input name="servingLabel" required value="${escapeHtml(item.servingLabel ?? '')}" placeholder="1 bowl, 1 tablet, 2 scoops"></label>
        <label>Servings<input name="servings" type="number" min="0.25" step="0.25" inputmode="decimal" value="${escapeHtml(draft.servings ?? 1)}" required><small>Use the stepper or type an amount.</small></label>
      </div><label class="choice inline-choice"><input type="checkbox" name="favorite"${checked(item.favorite)}><span>Favorite</span></label></section>
      <section class="card stack"><h2>Macros per serving</h2><div class="field-grid">${MACRO_NUTRIENTS.map(definition => nutrientInput(definition, item)).join('')}</div></section>
      <section class="card stack"><h2>Tracked nutrients per serving</h2><p class="muted">Leave an unknown value blank. It will not be counted as zero.</p><div class="field-grid">${tracked.map(definition => nutrientInput(definition, item)).join('')}</div></section>
      <section class="card stack"><h2>Details and evidence</h2>
        <label>Ingredient or component breakdown<textarea name="components" rows="4" placeholder="One component per line">${escapeHtml(components)}</textarea></label>
        <label>Assumptions<textarea name="assumptions" rows="3" placeholder="One assumption per line">${escapeHtml(assumptions)}</textarea></label>
      </section>
${item.type === 'supplement' ? `<section class="card stack"><h2>Supplement schedule</h2><p class="muted">For supplements, enter exact label amounts above and choose when you plan to take this product.</p><label>Frequency<select name="scheduleFrequency"><option value="daily"${selected(item.schedule?.frequency, 'daily')}>Daily</option><option value="weekly"${selected(item.schedule?.frequency, 'weekly')}>Weekly</option><option value="custom"${selected(item.schedule?.frequency, 'custom')}>Custom days</option></select></label><fieldset><legend>Scheduled days</legend><div class="check-grid">${WEEKDAYS.map((day, index) => `<label class="choice inline-choice"><input type="checkbox" name="scheduleDays" value="${index}"${checked(item.schedule?.days?.includes(index))}><span>${day}</span></label>`).join('')}</div></fieldset></section>` : ''}
      ${formNotice(ui, 'confirm-item')}
      <div class="stack"><button class="secondary-button full-width" type="submit" name="intent" value="save">Save to Library</button>${item.type === 'supplement'
        ? `<button class="primary-button full-width" type="submit" name="intent" value="complete">Mark complete for ${escapeHtml(dateLabel(state.selectedDate))}</button>`
        : `<button class="primary-button full-width" type="submit" name="intent" value="log">${draft.mode === 'logEdit' ? 'Save changes to' : 'Add to'} ${escapeHtml(dateLabel(state.selectedDate))}</button>`}</div>
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
  </section>`;
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

export function renderSettings({ data, ui = {} }) {
  const { profile, settings, targets, library, meta } = data;
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
    <form class="card stack" data-action="save-integrations"><div><h2>Analysis integrations</h2><p class="muted">Keys and tracker data are saved locally and keys are excluded from ordinary exports. Analysis content you submit goes directly from this browser to your configured Anthropic and USDA services.</p><p class="muted">Without your own FoodData Central key, the app uses a shared demo key that allows only about 30 ingredient lookups an hour.</p><ul class="evidence-list"><li><a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Create an Anthropic API key</a></li><li><a href="https://api.data.gov/signup/" target="_blank" rel="noreferrer">Get a free FoodData Central API key</a></li></ul></div><label>Anthropic API key<input name="anthropicApiKey" type="password" autocomplete="off" value="${escapeHtml(settings.anthropicApiKey)}"></label><label>FoodData Central API key<input name="foodDataCentralApiKey" type="password" autocomplete="off" value="${escapeHtml(settings.foodDataCentralApiKey)}"></label><label>Claude model<input name="model" type="text" value="${escapeHtml(settings.model)}"></label>${formNotice(ui, 'save-integrations')}<button class="secondary-button" type="submit">Save integrations</button></form>
    <section class="card stack" aria-labelledby="install-heading"><h2 id="install-heading">Install and offline use</h2><div class="stack" data-region="install-status">${renderInstallStatus(ui)}</div></section>
    <section class="card stack" aria-labelledby="data-heading"><h2 id="data-heading">Export and import</h2><p><strong>${meta.lastExportAt ? `Last export: ${escapeHtml(new Date(meta.lastExportAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }))}` : 'No export saved from this device yet.'}</strong> Your history lives only in this browser, so export regularly and keep the file somewhere safe.</p><p class="muted">Downloads contain your local tracker history. By default, API keys are excluded. Files you save may be readable by others with access to them.</p><form class="stack" data-action="export-data"><label class="choice inline-choice"><input name="includeSecrets" type="checkbox"><span>Include API keys in export</span></label><p class="muted">Warning: including API keys exposes them to anyone who can open the downloaded file. You will be asked to confirm.</p><button class="secondary-button" type="submit">Download export</button></form><form class="stack" data-action="import-data"><label>Choose JSON export<input name="file" type="file" accept=".json,application/json" required></label><label class="choice inline-choice"><input name="includeSecrets" type="checkbox"><span>Include API keys from import</span></label><p class="muted">Import replaces local tracker data. Imported API keys are excluded unless you choose to include them and confirm.</p><button class="secondary-button" type="submit">Import file</button></form>${ui.dataStatus ? `<p role="status">${escapeHtml(ui.dataStatus)}</p>` : ''}</section>
    <section class="card stack" aria-labelledby="evidence-notes"><div><h2 id="evidence-notes">Evidence notes</h2><p class="muted">Targets distinguish RDAs, AIs, limits, and evidence-informed ranges.</p></div><ul class="evidence-list">${NUTRIENTS.filter(item => item.citation).map(item => `<li><a href="${escapeHtml(item.citation)}" target="_blank" rel="noreferrer">${escapeHtml(item.label)}: ${escapeHtml(item.evidence)}</a></li>`).join('')}</ul></section>
    <section class="card stack danger-zone" aria-labelledby="restart-heading"><div><h2 id="restart-heading">Onboarding and local data</h2><p class="muted">Restart onboarding without deleting your saved history, or erase all local data with the exact confirmation.</p></div><button class="secondary-button" type="button" data-action="restart-onboarding">Restart onboarding</button><form class="inline-form" data-action="reset-data"><label>Type RESET ALL DATA<input name="confirmation" autocomplete="off"></label><button class="danger-button" type="submit">Erase local data</button></form>${formNotice(ui, 'reset-data')}</section>
    <section class="card disclaimer-card" aria-labelledby="disclaimer-heading"><h2 id="disclaimer-heading">Disclaimer</h2><p>${DISCLAIMER}</p><p class="muted">Acknowledged: ${meta.disclaimerAcknowledgedAt ? escapeHtml(new Date(meta.disclaimerAcknowledgedAt).toLocaleDateString('en-US')) : 'Not yet'}</p></section>
  </section>`;
}

function renderGlobalNotices(ui, showDataStatus) {
  const alert = ui.notice?.tone === 'error' && !FORMS_WITH_NOTICES.has(ui.notice.form)
    ? `<p class="global-status is-error" role="alert">${escapeHtml(ui.notice.text)}</p>` : '';
  const dataStatus = showDataStatus && ui.dataStatus ? `<p class="global-status" role="status">${escapeHtml(ui.dataStatus)}</p>` : '';
  return `<div data-region="update-banner" role="status">${renderUpdateBanner(ui)}</div>${alert}${dataStatus}`;
}

export function renderApp({ state, data, computedTargets = data.targets.computed, effectiveTargets = resolveEffectiveTargets(data.targets), ui = {} }) {
  if (!data.meta.onboardingComplete) {
    return `<a class="skip-link" href="#main-content">Skip to content</a>
      <header class="app-header"><div class="brand-mark" aria-hidden="true">L</div><span>Longevity</span></header>
      ${renderGlobalNotices(ui, true)}
      ${renderOnboarding({ data, computedTargets, draft: state.draft })}`;
  }
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
