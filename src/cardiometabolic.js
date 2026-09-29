// Daily heart and glucose planning states: free sugar, fiber, saturated fat, trans fat, and sodium. A known
// excess is reported even when other foods are unknown; "within target" needs complete evidence. These are
// planning references, not a diagnosis or a prediction of anyone's glucose response.
import { CARDIOMETABOLIC_TARGET_DEFAULTS } from './constants.js';

const valueOf = (nutrients, key) => Number.isFinite(nutrients?.[key]) ? nutrients[key]
  : Number.isFinite(nutrients?.micros?.[key]) ? nutrients.micros[key] : null;
// Supplement Facts panels list every nutrient present, so a labeled supplement is not an unknown source.
const isLabeledSupplement = item => item.type === 'supplement' && !item.reason;
const number = (value, digits = 0) => Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
const grams = value => `${number(value, value < 10 && !Number.isInteger(value) ? 1 : 0)} g`;

function evidence(items, key) {
  const unknownItems = [];
  let known = 0;
  let any = false;
  for (const item of items ?? []) {
    const value = valueOf(item.nutrients, key);
    if (Number.isFinite(value)) {
      known += value;
      any = true;
      if (item.provenance?.[key]?.partial) unknownItems.push(item.name);
    } else if (!isLabeledSupplement(item)) unknownItems.push(item.name);
  }
  return { known: any ? known : null, unknownItems, complete: unknownItems.length === 0 && (items ?? []).length > 0 };
}

export function cardiometabolicDay({ items = [], nutrients = {}, calorieEvidence = {}, targets = {}, calorieTarget } = {}) {
  const t = { ...CARDIOMETABOLIC_TARGET_DEFAULTS, ...Object.fromEntries(Object.entries(targets ?? {}).filter(([, value]) => Number.isFinite(value))) };
  const amountFor = (key, found) => valueOf(nutrients, key) ?? found.known;

  // Free sugar: a maximum.
  const free = evidence(items, 'freeSugarG');
  const freeAmount = amountFor('freeSugarG', free);
  const freeState = Number.isFinite(freeAmount) && freeAmount > t.freeSugarMaxG ? 'high'
    : free.complete && Number.isFinite(freeAmount) ? 'met' : 'unknown';
  const freeSugar = { id: 'freeSugar', label: 'Free sugar', amount: freeAmount, target: t.freeSugarMaxG, state: freeState,
    complete: free.complete, unknownItems: free.unknownItems,
    display: Number.isFinite(freeAmount) ? `${free.complete ? '' : 'At least '}${grams(freeAmount)}` : 'Unknown',
    targetDisplay: `${grams(t.freeSugarMaxG)} maximum`,
    reason: freeState === 'unknown' && free.unknownItems.length ? `Free sugar unknown for ${free.unknownItems.join(', ')}` : '' };

  // Fiber: a minimum with a preferred amount; more is never flagged.
  const fiberEvidence = evidence(items, 'fiberG');
  const fiberAmount = amountFor('fiberG', fiberEvidence);
  const fiberState = !Number.isFinite(fiberAmount) ? 'unknown' : fiberAmount >= t.fiberPreferredG ? 'preferred'
    : fiberAmount >= t.fiberMinG ? 'met' : 'inProgress';
  const fiber = { id: 'fiber', label: 'Fiber', amount: fiberAmount, target: t.fiberMinG, preferred: t.fiberPreferredG, state: fiberState,
    complete: fiberEvidence.complete, unknownItems: fiberEvidence.unknownItems,
    display: Number.isFinite(fiberAmount) ? grams(fiberAmount) : 'Unknown',
    targetDisplay: `${number(t.fiberMinG)}–${number(t.fiberPreferredG)} g`, reason: '' };

  // Saturated fat: a share of calories. During the day, a gram budget from the calorie target; the final
  // percentage needs complete calorie and saturated-fat evidence with calories above zero.
  const sat = evidence(items, 'saturatedFatG');
  const satAmount = amountFor('saturatedFatG', sat);
  const calories = valueOf(nutrients, 'calories');
  const budgetG = Number.isFinite(calorieTarget) ? calorieTarget * t.saturatedFatPercentMax / 100 / 9 : null;
  const finalPercent = calorieEvidence.complete && calories > 0 && sat.complete && Number.isFinite(satAmount)
    ? satAmount * 9 / calories * 100 : null;
  let satState = 'unknown';
  if (Number.isFinite(finalPercent)) satState = finalPercent <= t.saturatedFatPercentMax ? 'met' : 'high';
  else if (Number.isFinite(satAmount) && Number.isFinite(budgetG) && satAmount > budgetG) satState = 'high';
  const saturatedFat = { id: 'saturatedFat', label: 'Saturated fat', amount: satAmount, percent: finalPercent, budgetG,
    target: t.saturatedFatPercentMax, state: satState, complete: Number.isFinite(finalPercent), unknownItems: sat.unknownItems,
    display: Number.isFinite(finalPercent) ? `${number(finalPercent, 1)}% of calories`
      : Number.isFinite(satAmount) ? `${sat.complete ? '' : 'At least '}${grams(satAmount)}` : 'Unknown',
    targetDisplay: Number.isFinite(finalPercent) || !Number.isFinite(budgetG)
      ? `${number(t.saturatedFatPercentMax, 1)}% of calories` : `${grams(budgetG)} planning budget (${number(t.saturatedFatPercentMax, 1)}%)`,
    reason: Number.isFinite(finalPercent) ? '' : 'The final percentage needs complete calorie and saturated-fat evidence.' };

  // Trans fat: a positive amount, "0 g declared" when every food declares zero, or an ingredient warning.
  const trans = evidence(items, 'transFatG');
  const transAmount = amountFor('transFatG', trans);
  const warning = (items ?? []).some(item => item.ingredientEvidence?.partiallyHydrogenated);
  const transState = Number.isFinite(transAmount) && transAmount > t.transFatMaxG ? 'high'
    : warning ? 'attention' : trans.complete && transAmount === 0 ? 'declared' : 'unknown';
  const transFat = { id: 'transFat', label: 'Trans fat', amount: transAmount, target: t.transFatMaxG, state: transState,
    complete: trans.complete, unknownItems: trans.unknownItems,
    display: transState === 'high' ? grams(transAmount) : transState === 'attention' ? 'Possible trans fat'
      : transState === 'declared' ? '0 g declared' : 'Unknown',
    targetDisplay: 'Avoid',
    reason: warning ? 'Partially hydrogenated oil is listed; labels may round small amounts to 0 g.' : '' };

  // Sodium: an ideal limit and a hard maximum.
  const salt = evidence(items, 'sodiumMg');
  const sodiumAmount = amountFor('sodiumMg', salt);
  const sodiumState = Number.isFinite(sodiumAmount) && sodiumAmount > t.sodiumHardMaxMg ? 'aboveMaximum'
    : Number.isFinite(sodiumAmount) && sodiumAmount > t.sodiumIdealMaxMg ? 'aboveIdeal'
      : salt.complete && Number.isFinite(sodiumAmount) ? 'met' : 'unknown';
  const sodium = { id: 'sodium', label: 'Sodium', amount: sodiumAmount, ideal: t.sodiumIdealMaxMg, target: t.sodiumHardMaxMg,
    state: sodiumState, complete: salt.complete, unknownItems: salt.unknownItems,
    display: Number.isFinite(sodiumAmount) ? `${salt.complete ? '' : 'At least '}${number(sodiumAmount)} mg` : 'Unknown',
    targetDisplay: `${number(t.sodiumIdealMaxMg)} mg ideal · ${number(t.sodiumHardMaxMg)} mg limit`, reason: '' };

  return { freeSugar, fiber, saturatedFat, transFat, sodium };
}

const MEAL_STATES = ['low', 'moderate', 'possiblyHigh', 'high', 'partial', 'unknown'];

// days: [{ cardiometabolic, meals: [calculateMealMetrics results] }] for days with logged food. Percentages use
// only days (or meals) with complete evidence, and every count keeps its denominator.
export function cardiometabolicPeriod(days) {
  const logged = days ?? [];
  const states = metric => logged.map(day => day.cardiometabolic?.[metric]).filter(Boolean);
  const count = (metric, test) => states(metric).filter(test).length;
  const loggedDays = logged.length;
  const meals = logged.flatMap(day => day.meals ?? []);
  return {
    freeSugar: { withinDays: count('freeSugar', item => item.state === 'met'),
      highDays: count('freeSugar', item => item.state === 'high'),
      completeDays: count('freeSugar', item => item.state !== 'unknown'), loggedDays },
    fiber: { minimumDays: count('fiber', item => ['met', 'preferred'].includes(item.state)),
      preferredDays: count('fiber', item => item.state === 'preferred'),
      completeDays: count('fiber', item => item.complete || ['met', 'preferred'].includes(item.state)), loggedDays },
    saturatedFat: { withinDays: count('saturatedFat', item => item.state === 'met'),
      highDays: count('saturatedFat', item => item.state === 'high'),
      completeDays: count('saturatedFat', item => item.state !== 'unknown'), loggedDays },
    transFat: { declaredZeroDays: count('transFat', item => item.state === 'declared'),
      attentionDays: count('transFat', item => item.state === 'attention'),
      positiveDays: count('transFat', item => item.state === 'high'), loggedDays },
    sodium: { idealDays: count('sodium', item => item.state === 'met'),
      hardDays: count('sodium', item => item.state === 'met' || (item.state === 'aboveIdeal' && item.complete)),
      aboveMaximumDays: count('sodium', item => item.state === 'aboveMaximum'),
      completeDays: count('sodium', item => item.state !== 'unknown' && (item.complete || item.state !== 'aboveIdeal')), loggedDays },
    meals: {
      total: meals.length,
      ...Object.fromEntries(MEAL_STATES.map(state => [state, meals.filter(meal => meal.glState === state).length])),
      refinedHeavy: meals.filter(meal => meal.refinedHeavy === true).length,
      withRatio: meals.filter(meal => meal.refinedHeavy !== null).length
    }
  };
}
