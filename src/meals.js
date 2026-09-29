// Meals: which logged foods were eaten together, and per-meal estimated glycemic load, fiber-to-carbohydrate
// ratio, and protein. Entries logged before meals existed stay unassigned; no grouping is invented for them.
import { availableCarbs } from './glycemic.js';

export const MEAL_TYPES = Object.freeze([
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snack', label: 'Snack' },
  { id: 'other', label: 'Other' }
]);

const REUSE_MINUTES = 90;
const pad = value => String(value).padStart(2, '0');

export function mealTypeForHour(hour) {
  if (hour >= 5 && hour < 11) return 'breakfast';
  if (hour >= 11 && hour < 16) return 'lunch';
  if (hour >= 16 && hour < 22) return 'dinner';
  return 'snack';
}

const minutesOf = consumedAt => {
  const match = /T(\d{2}):(\d{2})/.exec(String(consumedAt ?? ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

// The meal a new entry most likely belongs to: the latest meal on the same date within 90 minutes, or a new
// meal (mealId null, for the caller to create) named by the local time of day.
export function suggestMealIdentity({ date, now = new Date(), entries = [] }) {
  const consumedAt = `${date}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const nearby = entries
    .filter(entry => entry.mealId && String(entry.consumedAt ?? '').startsWith(`${date}T`))
    .map(entry => ({ entry, gap: Math.abs(minutes - minutesOf(entry.consumedAt)) }))
    .filter(item => Number.isFinite(item.gap) && item.gap <= REUSE_MINUTES)
    .sort((left, right) => left.gap - right.gap)[0];
  return nearby
    ? { mealId: nearby.entry.mealId, mealType: nearby.entry.mealType ?? mealTypeForHour(now.getHours()), consumedAt }
    : { mealId: null, mealType: mealTypeForHour(now.getHours()), consumedAt };
}

export function groupMealEntries(entries) {
  const groups = new Map();
  for (const entry of entries ?? []) {
    const key = entry.mealId ?? '__unassigned__';
    if (!groups.has(key)) {
      groups.set(key, { mealId: entry.mealId ?? null, mealType: entry.mealId ? entry.mealType ?? 'other' : 'unassigned',
        consumedAt: entry.mealId ? entry.consumedAt ?? null : null, entries: [] });
    }
    const group = groups.get(key);
    group.entries.push(entry);
    if (entry.mealId && entry.consumedAt && (!group.consumedAt || entry.consumedAt < group.consumedAt)) group.consumedAt = entry.consumedAt;
  }
  return [...groups.values()].sort((left, right) => (left.consumedAt ?? '9999').localeCompare(right.consumedAt ?? '9999'));
}

const round1 = value => Math.round(value * 10) / 10;

export function calculateMealMetrics(entries, ratioDenominator = 10) {
  const list = entries ?? [];
  const valuesOf = key => list.map(entry => entry.nutrients?.[key]);
  const total = key => valuesOf(key).every(Number.isFinite) && list.length ? valuesOf(key).reduce((sum, value) => sum + value, 0) : null;
  const knownSum = key => valuesOf(key).filter(Number.isFinite).reduce((sum, value) => sum + value, 0);
  const unknownFor = key => list.filter(entry => !Number.isFinite(entry.nutrients?.[key])).map(entry => entry.name);

  const carbsG = total('carbsG');
  const fiberG = total('fiberG');
  const ratio = Number.isFinite(carbsG) && carbsG > 0 && Number.isFinite(fiberG) ? fiberG / carbsG : null;
  const fiberCarbLabel = ratio !== null ? (ratio > 0 ? `1:${(1 / ratio).toFixed(1)}` : 'No fiber')
    : carbsG === 0 ? 'Not applicable' : 'Unknown';
  const refinedHeavy = ratio === null ? null : ratio < 1 / ratioDenominator;
  const available = list.map(entry => availableCarbs(entry.nutrients));

  // Each entry's GL: its logged glycemic evidence, or zero for a food with under 1 g available carbohydrate.
  let gl = 0;
  let min = 0;
  let max = 0;
  let knownMaterial = 0;
  const missingGiItems = [];
  list.forEach((entry, index) => {
    const evidence = entry.glycemic;
    if (Number.isFinite(evidence?.gl) && evidence.completeness !== 'unknown') {
      gl += evidence.gl;
      min += evidence.range?.min ?? evidence.gl;
      max += evidence.range?.max ?? evidence.gl;
      if (evidence.gl > 0) knownMaterial += 1;
      if (evidence.completeness === 'partial') missingGiItems.push(...(evidence.missingFrom ?? []).map(name => `${entry.name}: ${name}`));
    } else if (Number.isFinite(available[index]) && available[index] < 1) {
      // No meaningful carbohydrate: contributes nothing.
    } else missingGiItems.push(entry.name);
  });
  const glCompleteness = !list.length ? 'unknown' : !missingGiItems.length ? 'complete' : knownMaterial ? 'partial' : 'unknown';
  const glKnown = glCompleteness !== 'unknown';
  let glState = 'unknown';
  if (glCompleteness === 'complete') {
    glState = min > 20 ? 'high' : gl > 20 ? 'possiblyHigh' : gl > 10 ? 'moderate' : 'low';
  } else if (glCompleteness === 'partial') {
    glState = min > 20 ? 'high' : 'partial';
  }

  return {
    carbsG,
    availableCarbsG: available.every(Number.isFinite) && list.length ? available.reduce((sum, value) => sum + value, 0) : null,
    fiberG,
    proteinG: knownSum('proteinG'),
    gl: glKnown ? round1(gl) : null,
    glPrecise: glKnown ? gl : null,
    glRange: glKnown ? { min: round1(min), max: round1(max) } : null,
    glCompleteness,
    glState,
    fiberCarbRatio: ratio,
    fiberCarbLabel,
    refinedHeavy,
    unknownProteinItems: unknownFor('proteinG'),
    unknownFiberItems: unknownFor('fiberG'),
    unknownCarbItems: unknownFor('carbsG'),
    missingGiItems
  };
}
