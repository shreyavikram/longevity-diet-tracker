// Today's target bars: turns a dailySummary() result into one bar per metric with its value, target, a
// traffic-light level, bar geometry, a plain-language meaning, and the foods behind it. Problems are the
// yellow and red bars; everything else is "on track" (or unknown, which is never shown as green).
import { macroStatus } from './calculations.js';
import { availableCarbs } from './glycemic.js';
import { MEAL_TYPES } from './meals.js';

const LEVEL_RANK = { behind: 0, close: 1 };
const PINNED = ['calories', 'protein'];
const SYMBOL = { good: '✓', close: '◐', behind: '!', unknown: '?' };

const mealName = type => MEAL_TYPES.find(option => option.id === type)?.label ?? 'Meal';
const number = value => Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 });

// One sentence on what the metric is, and where its target comes from.
const COPY = {
  calories: { label: 'Calories', unit: 'kcal', meaning: 'Energy from food. Your target sets a steady fat-loss pace.' },
  protein: { label: 'Protein', unit: 'g', meaning: 'Protects muscle while you lose fat and helps you recover from lifting.',
    note: () => 'About 2 g per kg of body weight.' },
  fiber: { label: 'Fiber', unit: 'g', meaning: 'Slows how fast carbs reach your blood and keeps you full.',
    note: t => `At least ${number(t.fiberMinG)} g, ${number(t.fiberPreferredG)} g preferred.` },
  solubleFiber: { label: 'Soluble fiber', unit: 'g', meaning: 'The gel-forming fiber in oats, beans, barley, and psyllium. It lowers LDL cholesterol and softens blood sugar rises.',
    note: t => `${number(t.solubleFiberMinG)} to ${number(t.solubleFiberPreferredG)} g a day (Portfolio diet evidence). Labels and USDA rarely list it, so it is often unknown.` },
  carbs: { label: 'Carbs', unit: 'g', meaning: 'Carbohydrate is what raises blood sugar most. A moderate amount, spread across meals, suits prediabetes.',
    note: t => `${number(t.carbsPercentMin)} to ${number(t.carbsPercentMax)}% of today's calories, and ${number(t.mealCarbsMaxG)} g or less per meal.` },
  fat: { label: 'Fat', unit: 'g', meaning: 'Keeps you full. For your heart, the type matters more than the amount: favor nuts, seeds, avocado, and olive oil.',
    note: t => `${number(t.fatPercentMin)} to ${number(t.fatPercentMax)}% of today's calories.` },
  sodium: { label: 'Sodium', unit: 'mg', meaning: 'Raises blood pressure over time. Salt, sauces, bread, and canned foods are the usual sources.',
    note: t => `American Heart Association: ${number(t.sodiumIdealMaxMg)} mg ideal, ${number(t.sodiumHardMaxMg)} mg limit.` },
  saturatedFat: { label: 'Saturated fat', unit: 'g', meaning: 'Raises LDL cholesterol. Coconut, palm oil, and vegan cheese are common sources.',
    note: t => `Under ${number(t.saturatedFatPercentMax)}% of calories (heart-focused limit), about ${number(t.calories * t.saturatedFatPercentMax / 100 / 9)} g today.` },
  freeSugar: { label: 'Free sugar', unit: 'g', meaning: 'Sugar added to food plus honey, syrups, and juice. The sugar inside whole fruit does not count.',
    note: t => `${number(t.freeSugarMaxG)} g or less, stricter than the WHO's 5% of calories.` },
  transFat: { label: 'Trans fat', unit: 'g', meaning: 'The most harmful fat for your heart, found in partially hydrogenated oil.',
    note: () => 'Avoid it entirely.' },
  gl: { label: 'Glycemic load', unit: 'GL', meaning: 'An estimate of how much the day\'s food raises blood sugar, from each food\'s GI and net carbs. It is not a prediction of your own response.',
    note: t => `${number(t.dailyGlMax)} or less a day. Per meal ${number(t.mealGlMax)} or less, 15 or less is ideal.` },
  water: { label: 'Water', unit: 'ml', meaning: 'Supports training, digestion, and appetite control.',
    note: () => 'About 35 ml per kg of body weight, 500 ml more on training days.' }
};
const ORDER = ['calories', 'protein', 'fiber', 'solubleFiber', 'carbs', 'fat', 'sodium', 'saturatedFat', 'freeSugar', 'transFat', 'gl'];

const valueOf = (nutrients, key) => Number.isFinite(nutrients?.[key]) ? nutrients[key]
  : Number.isFinite(nutrients?.micros?.[key]) ? nutrients.micros[key] : undefined;
// Supplement Facts panels list every nutrient present, so a labeled supplement is not an unknown source.
const isLabeledSupplement = item => item.type === 'supplement' && !item.reason;

// Known total, how many foods leave it unknown, and the foods behind it (largest first).
function evidenceFor(items, key) {
  let total = 0;
  let known = 0;
  let unknownCount = 0;
  const found = [];
  for (const item of items) {
    const amount = valueOf(item.nutrients, key);
    const provenance = item.provenance?.[key];
    if (Number.isFinite(amount)) {
      total += amount;
      known += 1;
      if (provenance?.partial) unknownCount += 1;
      if (amount > 0) found.push({ item, amount, provenance });
    } else if (!isLabeledSupplement(item)) unknownCount += 1;
  }
  const contributors = found.sort((left, right) => right.amount - left.amount).map(({ item, amount, provenance }) => {
    const parts = (provenance?.contributors ?? []).filter(part => Number.isFinite(part.amount) && part.amount > 0);
    return {
      name: item.name,
      amount,
      share: total > 0 ? amount / total : 0,
      estimate: provenance?.source === 'ai' || provenance?.confidence === 'low',
      parts: parts.length > 1 ? parts.map(part => ({ name: part.componentName ?? part.name ?? 'Ingredient', amount: part.amount }))
        .sort((left, right) => right.amount - left.amount) : []
    };
  });
  return { value: known ? total : null, unknownCount, contributors };
}

// Bar geometry in percent of the track. Past the reference the bar fills and the reference line moves left,
// never closer than a quarter of the track so it stays visible.
function geometry(value, reference, { min, ideal } = {}) {
  if (!Number.isFinite(reference) || reference <= 0) return { fill: Number.isFinite(value) && value > 0 ? 100 : 0 };
  const shown = Number.isFinite(value) ? value : 0;
  const scale = shown > reference ? Math.min(shown, reference * 4) : reference * 1.25;
  const percent = amount => Math.min(100, amount / scale * 100);
  return {
    fill: percent(shown),
    tick: percent(reference),
    ...(Number.isFinite(min) ? { zoneStart: percent(min), zoneEnd: percent(reference) } : {}),
    ...(Number.isFinite(ideal) ? { idealTick: percent(ideal) } : {})
  };
}

function status(level, statusLabel) {
  return { level, statusLabel, symbol: SYMBOL[level] };
}

function minimumStatus(value, target, dayProgress) {
  const result = macroStatus({ value: value ?? 0, target, kind: 'minimum', dayProgress });
  return result ? status(result.level, result.label) : status('unknown', 'No target');
}

function rangeStatus(value, { min, max }, dayProgress, unknownCount) {
  const amount = value ?? 0;
  if (amount > max * 1.15) return status('behind', 'Over');
  if (amount > max) return status('close', 'A little over');
  if (unknownCount) return status('unknown', 'Unknown for some foods');
  if (amount >= min) return status('good', 'In range');
  if (dayProgress < 1) return status('good', 'So far');
  return amount >= min * 0.7 ? status('close', 'A little under') : status('behind', 'Under');
}

function limitStatus(value, { max, ideal }, unknownCount) {
  if (Number.isFinite(value) && value > max) return status('behind', 'Over limit');
  if (Number.isFinite(value) && Number.isFinite(ideal) && value > ideal) return status('close', 'Above ideal');
  if (unknownCount || !Number.isFinite(value)) return status('unknown', 'Unknown for some foods');
  return status('good', 'Within limit');
}

function metric(id, kind, value, target, evidence, state, bar, t, extra = {}) {
  const copy = COPY[id];
  return {
    id, kind, label: copy.label, unit: copy.unit, value, target,
    atLeast: evidence.unknownCount > 0, unknownCount: evidence.unknownCount,
    ...state, bar, meaning: copy.meaning, targetNote: copy.note ? copy.note(t) : '',
    contributors: evidence.contributors, ...extra
  };
}

function glEvidence(items) {
  let total = 0;
  let known = 0;
  let unknownCount = 0;
  const found = [];
  for (const item of items.filter(entry => entry.type !== 'supplement')) {
    const evidence = item.glycemic;
    if (Number.isFinite(evidence?.gl) && evidence.completeness !== 'unknown') {
      total += evidence.gl;
      known += 1;
      if (evidence.completeness === 'partial') unknownCount += 1;
      if (evidence.gl > 0) found.push({ name: item.name, amount: evidence.gl });
    } else {
      const available = availableCarbs(item.nutrients);
      if (!(Number.isFinite(available) && available < 1)) unknownCount += 1;
    }
  }
  const contributors = found.sort((left, right) => right.amount - left.amount)
    .map(entry => ({ ...entry, share: total > 0 ? entry.amount / total : 0, estimate: true, parts: [] }));
  return { value: known ? total : null, unknownCount, contributors };
}

function mealProblems(meals, t) {
  const problems = [];
  for (const meal of meals ?? []) {
    if (!meal.mealId || !meal.metrics) continue;
    const name = mealName(meal.mealType);
    const carbs = evidenceFor(meal.entries, 'carbsG');
    if (Number.isFinite(carbs.value) && carbs.value > t.mealCarbsMaxG) {
      const level = carbs.value > t.mealCarbsMaxG * 1.3 ? 'behind' : 'close';
      problems.push({ id: `meal-${meal.mealId}-carbs`, kind: 'limit', label: `${name} carbs`, unit: 'g', value: carbs.value,
        target: { max: t.mealCarbsMaxG }, atLeast: carbs.unknownCount > 0, unknownCount: carbs.unknownCount,
        ...status(level, 'Over meal limit'), bar: geometry(carbs.value, t.mealCarbsMaxG),
        meaning: 'A large carb load at once causes a bigger blood sugar rise than the same carbs spread out.',
        targetNote: `${number(t.mealCarbsMaxG)} g or less per meal.`, contributors: carbs.contributors, mealId: meal.mealId });
    }
    const gl = meal.metrics.gl;
    if (Number.isFinite(gl) && gl > t.mealGlMax) {
      const level = meal.metrics.glState === 'high' ? 'behind' : 'close';
      const byFood = glEvidence(meal.entries);
      problems.push({ id: `meal-${meal.mealId}-gl`, kind: 'limit', label: `${name} GL`, unit: 'GL', value: gl,
        target: { max: t.mealGlMax }, atLeast: meal.metrics.glCompleteness === 'partial', unknownCount: byFood.unknownCount,
        ...status(level, level === 'behind' ? 'High' : 'Possibly high'), bar: geometry(gl, t.mealGlMax),
        meaning: COPY.gl.meaning, targetNote: `${number(t.mealGlMax)} or less per meal, 15 or less is ideal.`,
        contributors: byFood.contributors, mealId: meal.mealId });
    }
  }
  return problems;
}

// How far off a problem is, as a ratio: over a maximum is value / max, short of a minimum is min / value.
function severity(entry) {
  const value = entry.value ?? 0;
  // A zero limit (trans fat) is measured against the 0.5 g that labels round to zero.
  if (Number.isFinite(entry.target.max) && value > entry.target.max) return value / Math.max(entry.target.max, 0.5);
  if (Number.isFinite(entry.target.min)) return value > 0 ? entry.target.min / value : 10;
  return 1;
}

export function todayMetrics(daily, { dayProgress = 1 } = {}) {
  const t = daily?.targets;
  if (!t) return { pinned: [], problems: [], onTrack: [], water: null };
  const items = daily.items ?? [];
  const cardio = daily.cardiometabolic ?? {};
  const all = [];

  const calories = evidenceFor(items, 'calories');
  const calorieTarget = { min: Math.round(t.calories * 0.85), max: Math.round(t.calories * 1.05), goal: t.calories };
  const calorieStatus = macroStatus({ value: calories.value ?? 0, target: t.calories, kind: 'calories', dayProgress });
  const calorieState = !daily.calories?.complete && !(calories.value > t.calories * 1.15)
    ? status('unknown', 'Unknown for some foods') : status(calorieStatus.level, calorieStatus.label);
  all.push(metric('calories', 'range', calories.value, calorieTarget, calories, calorieState,
    geometry(calories.value, calorieTarget.max, { min: calorieTarget.min }), t,
    { targetNote: `85 to 105% of today's ${number(t.calories)} kcal target (${daily.trainingDay ? 'training' : 'rest'} day).` }));

  for (const [id, key, min, preferred] of [
    ['protein', 'proteinG', t.proteinG], ['fiber', 'fiberG', t.fiberMinG, t.fiberPreferredG],
    ['solubleFiber', 'solubleFiberG', t.solubleFiberMinG, t.solubleFiberPreferredG]]) {
    const evidence = evidenceFor(items, key);
    // No food reports it at all: unknown, not "behind".
    const state = evidence.value === null && items.length
      ? status('unknown', 'Unknown for these foods') : minimumStatus(evidence.value, min, dayProgress);
    all.push(metric(id, 'minimum', evidence.value, { min, ...(Number.isFinite(preferred) ? { preferred } : {}) }, evidence, state,
      geometry(evidence.value, min), t));
  }

  for (const [id, key, min, max] of [['carbs', 'carbsG', t.carbsMinG, t.carbsMaxG], ['fat', 'fatG', t.fatMinG, t.fatMaxG]]) {
    const evidence = evidenceFor(items, key);
    all.push(metric(id, 'range', evidence.value, { min, max }, evidence,
      rangeStatus(evidence.value, { min, max }, dayProgress, evidence.unknownCount), geometry(evidence.value, max, { min }), t));
  }

  const sodium = evidenceFor(items, 'sodiumMg');
  const sodiumTarget = { max: t.sodiumHardMaxMg, ideal: t.sodiumIdealMaxMg };
  all.push(metric('sodium', 'limit', sodium.value, sodiumTarget, sodium, limitStatus(sodium.value, sodiumTarget, sodium.unknownCount),
    geometry(sodium.value, sodiumTarget.max, { ideal: sodiumTarget.ideal }), t));

  const sat = evidenceFor(items, 'saturatedFatG');
  const satMax = t.calories * t.saturatedFatPercentMax / 100 / 9;
  let satState = limitStatus(sat.value, { max: satMax }, sat.unknownCount);
  if (Number.isFinite(cardio.saturatedFat?.percent)) {
    satState = cardio.saturatedFat.percent > t.saturatedFatPercentMax ? status('behind', 'Over limit') : status('good', 'Within limit');
  }
  all.push(metric('saturatedFat', 'limit', sat.value, { max: satMax }, sat, satState, geometry(sat.value, satMax), t));

  const free = evidenceFor(items, 'freeSugarG');
  all.push(metric('freeSugar', 'limit', free.value, { max: t.freeSugarMaxG }, free,
    limitStatus(free.value, { max: t.freeSugarMaxG }, free.unknownCount), geometry(free.value, t.freeSugarMaxG), t));

  const trans = evidenceFor(items, 'transFatG');
  // Labels round under 0.5 g to zero, and cheese or AI estimates often carry a trace, so a trace is a caution.
  const transState = Number.isFinite(trans.value) && trans.value > Math.max(t.transFatMaxG, 0.5) ? status('behind', 'Over limit')
    : Number.isFinite(trans.value) && trans.value > t.transFatMaxG ? status('close', 'Trace amount')
    : cardio.transFat?.state === 'attention' ? status('close', 'Check ingredients')
      : trans.unknownCount || !Number.isFinite(trans.value) ? status('unknown', 'Unknown for some foods') : status('good', 'None');
  // No target line for trans fat: the target is none at all. The track spans 0 to 2 g.
  const { tick: _noTick, ...transBar } = geometry(trans.value, 2);
  all.push(metric('transFat', 'limit', trans.value, { max: t.transFatMaxG }, trans, transState, transBar, t));

  const gl = glEvidence(items);
  all.push(metric('gl', 'limit', gl.value, { max: t.dailyGlMax }, gl, limitStatus(gl.value, { max: t.dailyGlMax }, gl.unknownCount),
    geometry(gl.value, t.dailyGlMax), t));

  // Nothing logged yet: no food metric can be judged.
  if (!items.length) for (const entry of all) Object.assign(entry, status('unknown', 'Nothing logged'));

  const byOrder = (left, right) => ORDER.indexOf(left.id) - ORDER.indexOf(right.id);
  // Calories and protein are her main goals, so they are always shown at the top, whatever their status.
  const pinned = all.filter(entry => PINNED.includes(entry.id));
  const rest = all.filter(entry => !PINNED.includes(entry.id));
  const problems = [...rest.filter(entry => entry.level in LEVEL_RANK), ...mealProblems(daily.meals, t)]
    .sort((left, right) => LEVEL_RANK[left.level] - LEVEL_RANK[right.level] || severity(right) - severity(left));
  const onTrack = rest.filter(entry => !(entry.level in LEVEL_RANK)).sort(byOrder);

  const waterMl = daily.waterMl ?? 0;
  const water = metric('water', 'minimum', waterMl, { min: t.waterMl }, { unknownCount: 0, contributors: [] },
    minimumStatus(waterMl, t.waterMl, dayProgress), geometry(waterMl, t.waterMl), t);
  return { pinned, problems, onTrack, water };
}
