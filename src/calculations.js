import { NUTRIENTS } from './constants.js';

const DEFICIT_BY_PACE = Object.freeze({ gentle: 0.1, moderate: 0.175, faster: 0.25 });
const round25 = value => Math.round(value / 25) * 25;

export function computeTargets(profile) {
  const sexOffset = profile.sexForBmr === 'male' ? 5 : -161;
  const rawBmr = 10 * profile.weightKg + 6.25 * profile.heightCm - 5 * profile.age + sexOffset;
  const bmr = round25(rawBmr);
  const maintenanceCalories = round25(rawBmr * profile.activityMultiplier);
  const unboundedAverage = round25(maintenanceCalories * (1 - DEFICIT_BY_PACE[profile.pace]));
  const averageCalories = Math.max(bmr, unboundedAverage);
  const clampedToBmr = averageCalories === bmr && unboundedAverage < bmr;
  const plannedTrainingDays = Math.max(0, Math.min(6, Math.round(profile.liftDaysPerWeek)));
  let trainingDayCalories = averageCalories;
  let restDayCalories = averageCalories;
  if (!clampedToBmr && plannedTrainingDays > 0) {
    const trainingBoost = round25(Math.min(150, averageCalories * 0.06));
    trainingDayCalories = averageCalories + trainingBoost;
    restDayCalories = round25(
      (averageCalories * 7 - trainingDayCalories * plannedTrainingDays) /
      (7 - plannedTrainingDays)
    );
    if (restDayCalories < bmr) {
      trainingDayCalories = averageCalories;
      restDayCalories = averageCalories;
    }
  }
  const waterMl = Math.round(profile.weightKg * 35 / 100) * 100;
  return {
    pace: profile.pace,
    plannedTrainingDays,
    deficitPercent: DEFICIT_BY_PACE[profile.pace] * 100,
    bmr,
    maintenanceCalories,
    averageCalories,
    trainingDayCalories,
    restDayCalories,
    weeklyCalories: averageCalories * 7,
    clampedToBmr,
    proteinG: Math.round(profile.weightKg * 2 / 5) * 5,
    fiberG: 35,
    waterMl,
    trainingDayWaterMl: waterMl + 500,
    carbsG: null,
    fatG: null
  };
}

export function resolveEffectiveTargets(targets) {
  if (!targets?.computed) return null;
  const computed = structuredClone(targets.computed);
  const overrides = targets.overrides ?? {};
  const effective = { ...computed };
  if (Number.isFinite(overrides.averageCalories)) {
    const plannedTrainingDays = Number.isInteger(computed.plannedTrainingDays)
      ? computed.plannedTrainingDays
      : computed.trainingDayCalories === computed.restDayCalories ? 0
        : Math.round((computed.weeklyCalories - computed.restDayCalories * 7)
          / (computed.trainingDayCalories - computed.restDayCalories));
    const days = Math.max(0, Math.min(6, plannedTrainingDays));
    const desiredBoost = Math.max(0, computed.trainingDayCalories - computed.averageCalories);
    const maxBoost = days ? Math.max(0, (overrides.averageCalories - computed.bmr) * (7 - days) / days) : 0;
    let boost = desiredBoost > maxBoost ? 0 : Math.floor(desiredBoost);
    while (boost > 0 && boost * days % (7 - days) !== 0) boost -= 1;
    effective.averageCalories = overrides.averageCalories;
    effective.trainingDayCalories = overrides.averageCalories + boost;
    effective.restDayCalories = days
      ? (overrides.averageCalories * 7 - effective.trainingDayCalories * days) / (7 - days)
      : overrides.averageCalories;
    effective.weeklyCalories = overrides.averageCalories * 7;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (key !== 'averageCalories' && Number.isFinite(value)) effective[key] = value;
  }
  return effective;
}

export function computeDayTargets(targets, trainingDay) {
  const effective = targets?.computed ? resolveEffectiveTargets(targets) : targets;
  return {
    ...effective,
    calories: trainingDay ? effective.trainingDayCalories : effective.restDayCalories,
    waterMl: trainingDay ? effective.trainingDayWaterMl : effective.waterMl
  };
}

function scaleKnownValues(values, factor) {
  const scaled = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (Number.isFinite(value)) {
      scaled[key] = value * factor;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = scaleKnownValues(value, factor);
      if (Object.keys(nested).length) scaled[key] = nested;
    }
  }
  return scaled;
}

export function scaleNutrients(perServing, servings) {
  if (!Number.isFinite(servings) || servings < 0) throw new RangeError('Servings must be a non-negative number');
  return scaleKnownValues(perServing, servings);
}

export function normalizeNutrients(perServing) {
  return scaleKnownValues(perServing, 1);
}

function addKnown(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (Number.isFinite(value)) target[key] = (target[key] ?? 0) + value;
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      target[key] ??= {};
      addKnown(target[key], value);
      if (Object.keys(target[key]).length === 0) delete target[key];
    }
  }
  return target;
}

export function sumNutrients(items) {
  return items.reduce((total, item) => addKnown(total, item.nutrients ?? item), {});
}

export function coverageState(total, definition, hasKnownSource = Number.isFinite(total)) {
  if (!hasKnownSource || !Number.isFinite(total)) return 'unknown';
  if (Number.isFinite(definition.upperLimit) && total > definition.upperLimit) return 'high';
  if (definition.kind === 'maximum') {
    const maximum = definition.targetMax;
    return Number.isFinite(maximum) && total > maximum ? 'high' : 'met';
  }
  return total >= definition.targetMin ? 'met' : 'inProgress';
}

export const kgToLb = kg => kg * 2.2046226218;
export const lbToKg = lb => lb / 2.2046226218;
export const cmToIn = cm => cm / 2.54;
export const inToCm = inches => inches * 2.54;
export const mlToFlOz = ml => ml / 29.5735295625;
export const flOzToMl = ounces => ounces * 29.5735295625;

export function nutrientValue(nutrients, definition) {
  return definition.group ? nutrients?.[definition.group]?.[definition.key] : nutrients?.[definition.key];
}

export function isSupplementScheduled(item, date) {
  if (item?.type !== 'supplement' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const frequency = item.schedule?.frequency;
  if (frequency === 'daily') return true;
  if (!['weekly', 'custom'].includes(frequency)) return false;
  const day = new Date(`${date}T12:00:00`).getDay();
  return Array.isArray(item.schedule?.days) && item.schedule.days.includes(day);
}

export function supplementCompletionItems(dayState, date) {
  const day = dayState?.[date];
  const completed = new Set(day?.supplementsCompleted ?? []);
  const snapshots = day?.supplementSnapshots ?? {};
  const items = [];
  for (const itemId of completed) {
    const snapshot = snapshots[itemId];
    if (!snapshot || !Object.hasOwn(snapshot, 'perServing')) {
      items.push({
        id: itemId,
        type: 'supplement',
        name: 'Completed supplement (historical label unavailable)',
        servingLabel: 'Label snapshot unavailable',
        date,
        nutrients: {},
        provenance: {},
        reason: 'missingHistoricalSnapshot'
      });
      continue;
    }
    items.push({
      id: snapshot.id ?? itemId,
      type: 'supplement',
      name: snapshot.name ?? 'Supplement',
      servingLabel: snapshot.servingLabel ?? '',
      schedule: structuredClone(snapshot.schedule ?? {}),
      date,
      nutrients: scaleNutrients(snapshot.perServing, 1),
      provenance: structuredClone(snapshot.provenance ?? {})
    });
  }
  return items;
}

export function supplementCompletionSummary(dayState, date) {
  const items = supplementCompletionItems(dayState, date);
  const limitations = items
    .filter(item => item.reason)
    .map(item => ({ itemId: item.id, date, name: item.name, reason: item.reason }));
  return { nutrients: sumNutrients(items), limitations, items };
}

export function completedSupplementNutrients(library, dayState, date) {
  void library;
  return supplementCompletionSummary(dayState, date).nutrients;
}

function assertLocalDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('A local YYYY-MM-DD date is required');
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TypeError('A valid local YYYY-MM-DD date is required');
  }
}

function addDays(date, amount) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function summaryData(stores) {
  if (stores && typeof stores.loadAll === 'function') return stores.loadAll();
  if (!stores || typeof stores !== 'object') throw new TypeError('Summary stores are required');
  return stores;
}

function summaryItems(data, date) {
  const food = (data.log?.[date] ?? []).map(entry => ({
    id: entry.id,
    type: entry.type ?? 'meal',
    name: entry.name ?? 'Logged item',
    servingLabel: entry.servingLabel ?? '',
    nutrients: entry.nutrients ?? {},
    provenance: entry.provenance ?? {}
  }));
  return [...food, ...supplementCompletionItems(data.dayState, date)];
}

function effectiveDefinition(definition, targets, calorieTarget) {
  const next = { ...definition };
  if (definition.id === 'protein' && Number.isFinite(targets?.proteinG)) next.targetMin = targets.proteinG;
  if (definition.id === 'fiber' && Number.isFinite(targets?.fiberG)) next.targetMin = targets.fiberG;
  if (Number.isFinite(definition.percentEnergyMax) && Number.isFinite(calorieTarget)) {
    const caloriesPerGram = definition.id === 'saturatedFat' ? 9 : 4;
    next.targetMax = calorieTarget * definition.percentEnergyMax / 100 / caloriesPerGram;
  }
  return next;
}

function targetFor(definition) {
  return definition.kind === 'maximum' ? definition.targetMax : definition.targetMin;
}

// Supplement Facts labels list every nutrient present in a meaningful amount, so a supplement with a
// stored label snapshot is not an unknown source for nutrients its label omits. Omitted values stay
// absent (never zero); a supplement whose historical snapshot is missing remains unknown.
const isLabeledSupplement = item => item.type === 'supplement' && !item.reason;

function detailFor(items, definition, targets, calorieTarget, date) {
  const effective = effectiveDefinition(definition, targets, calorieTarget);
  const contributors = [];
  const unknownItems = [];
  for (const item of items) {
    const amount = nutrientValue(item.nutrients, definition);
    if (Number.isFinite(amount)) {
      contributors.push({
        date,
        itemId: item.id,
        itemType: item.type,
        name: item.name,
        amount,
        source: item.provenance?.[definition.key]?.source ?? 'snapshot',
        confidence: item.provenance?.[definition.key]?.confidence ?? null
      });
    } else if (!isLabeledSupplement(item)) {
      unknownItems.push({
        date,
        itemId: item.id,
        itemType: item.type,
        name: item.name,
        ...(item.reason ? { reason: item.reason } : {})
      });
    }
  }
  const total = contributors.length
    ? contributors.reduce((sum, contributor) => sum + contributor.amount, 0)
    : undefined;
  let state = coverageState(total, effective, contributors.length > 0);
  if (effective.kind === 'maximum' && state !== 'high' && unknownItems.length > 0) state = 'unknown';
  const highReason = state === 'high'
    && Number.isFinite(effective.upperLimit)
    && total > effective.upperLimit
    ? { type: 'dailyUpperLimit', date, amount: total, threshold: effective.upperLimit }
    : state === 'high' && effective.kind === 'maximum'
      ? { type: 'dailyMaximum', date, amount: total, threshold: effective.targetMax }
      : null;
  return {
    id: definition.id,
    label: definition.label,
    unit: definition.unit,
    total,
    target: targetFor(effective),
    targetMin: effective.targetMin,
    targetPreferred: effective.targetPreferred,
    targetMax: effective.targetMax,
    upperLimit: effective.upperLimit,
    dailyUpperLimit: effective.upperLimit,
    evidence: effective.evidence,
    citation: effective.citation ?? null,
    veganPriority: Boolean(effective.veganPriority),
    state,
    highReason,
    contributors,
    unknownItems
  };
}

export function dailySummary(date, stores) {
  assertLocalDate(date);
  const data = summaryData(stores);
  const trainingDay = Boolean(data.dayState?.[date]?.trainingDay);
  const effectiveTargets = resolveEffectiveTargets(data.targets);
  const targets = effectiveTargets ? computeDayTargets(data.targets, trainingDay) : null;
  const items = summaryItems(data, date);
  const nutrients = sumNutrients(items);
  nutrients.micros ??= {};
  const details = Object.fromEntries(NUTRIENTS.map(definition => [
    definition.id,
    detailFor(items, definition, targets, targets?.calories, date)
  ]));
  const calorieUnknownItems = items
    .filter(item => !Number.isFinite(item.nutrients?.calories) && !isLabeledSupplement(item))
    .map(item => ({
      date,
      itemId: item.id,
      itemType: item.type,
      name: item.name,
      ...(item.reason ? { reason: item.reason } : {})
    }));
  const calories = Number.isFinite(nutrients.calories) ? nutrients.calories : 0;
  const caloriesComplete = calorieUnknownItems.length === 0;
  return {
    date,
    trainingDay,
    targets,
    nutrients,
    waterMl: data.water?.[date] ?? 0,
    calories: { knownTotal: calories, complete: caloriesComplete, unknownItems: calorieUnknownItems },
    remainingCalories: caloriesComplete && Number.isFinite(targets?.calories)
      ? targets.calories - calories
      : null,
    details,
    items
  };
}

function weeklyDefinition(definition, effectiveTargets) {
  const calorieTarget = effectiveTargets?.weeklyCalories;
  const adjusted = effectiveDefinition(definition, effectiveTargets, calorieTarget);
  if (Number.isFinite(adjusted.targetMin)) adjusted.targetMin *= 7;
  if (Number.isFinite(adjusted.targetPreferred)) adjusted.targetPreferred *= 7;
  if (Number.isFinite(adjusted.targetMax) && !Number.isFinite(definition.percentEnergyMax)) adjusted.targetMax *= 7;
  if (Number.isFinite(adjusted.upperLimit)) adjusted.upperLimit *= 7;
  if (definition.id === 'protein' && Number.isFinite(effectiveTargets?.proteinG)) {
    adjusted.targetMin = effectiveTargets.proteinG * 7;
  }
  if (definition.id === 'fiber' && Number.isFinite(effectiveTargets?.fiberG)) {
    adjusted.targetMin = effectiveTargets.fiberG * 7;
  }
  return adjusted;
}

export function weeklyCoverage(endDate, stores) {
  assertLocalDate(endDate);
  const data = summaryData(stores);
  const dates = Array.from({ length: 7 }, (_, index) => addDays(endDate, index - 6));
  const days = dates.map(date => dailySummary(date, data));
  const effectiveTargets = resolveEffectiveTargets(data.targets);
  const nutrients = {};
  for (const definition of NUTRIENTS) {
    const adjusted = weeklyDefinition(definition, effectiveTargets);
    const contributors = days.flatMap(day => day.details[definition.id].contributors);
    const unknownItems = days.flatMap(day => day.details[definition.id].unknownItems);
    const total = contributors.length
      ? contributors.reduce((sum, contributor) => sum + contributor.amount, 0)
      : undefined;
    let state = coverageState(total, adjusted, contributors.length > 0);
    if (adjusted.kind === 'maximum' && state !== 'high' && unknownItems.length > 0) state = 'unknown';
    const dailyUpperLimitTrigger = days
      .map(day => day.details[definition.id].highReason)
      .find(reason => reason?.type === 'dailyUpperLimit') ?? null;
    if (dailyUpperLimitTrigger) state = 'high';
    if (state === 'unknown' && definition.veganPriority) state = 'attention';
    const highReason = dailyUpperLimitTrigger
      ?? (state === 'high' && adjusted.kind === 'maximum'
        ? { type: 'rollingMaximum', amount: total, threshold: adjusted.targetMax }
        : null);
    nutrients[definition.id] = {
      id: definition.id,
      label: definition.label,
      unit: definition.unit,
      total,
      target: targetFor(adjusted),
      targetMin: adjusted.targetMin,
      targetPreferred: adjusted.targetPreferred,
      targetMax: adjusted.targetMax,
      upperLimit: adjusted.upperLimit,
      dailyUpperLimit: definition.upperLimit,
      evidence: definition.evidence,
      citation: definition.citation ?? null,
      veganPriority: Boolean(definition.veganPriority),
      state,
      highReason,
      contributors,
      unknownItems
    };
  }
  const attentionRank = { attention: 0, high: 1, inProgress: 2 };
  const needsAttention = Object.values(nutrients)
    .filter(item => item.state === 'attention' || item.state === 'high'
      || (item.state === 'inProgress' && item.veganPriority))
    .sort((left, right) => attentionRank[left.state] - attentionRank[right.state]
      || NUTRIENTS.findIndex(item => item.id === left.id) - NUTRIENTS.findIndex(item => item.id === right.id));
  const caloriesTotal = days.reduce((sum, day) => sum + (day.nutrients.calories ?? 0), 0);
  const calorieUnknownItems = days.flatMap(day => day.calories.unknownItems);
  const caloriesComplete = calorieUnknownItems.length === 0;
  const caloriesTarget = effectiveTargets?.weeklyCalories ?? null;
  return {
    startDate: dates[0],
    endDate,
    dates,
    days,
    nutrients,
    needsAttention,
    calories: {
      total: caloriesTotal,
      complete: caloriesComplete,
      unknownItems: calorieUnknownItems,
      target: caloriesTarget,
      remaining: caloriesComplete && Number.isFinite(caloriesTarget)
        ? caloriesTarget - caloriesTotal
        : null
    }
  };
}
