import { NUTRIENTS } from './constants.js';
import { dailySummary } from './calculations.js';

const DAY_MS = 86_400_000;
const PACE_BANDS = Object.freeze({
  gentle: [0.1, 0.4],
  moderate: [0.3, 0.7],
  faster: [0.55, 0.95]
});

function dayNumber(date) {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / DAY_MS;
}

function validDate(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    && new Date(dayNumber(date) * DAY_MS).toISOString().slice(0, 10) === date;
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function validReadings(entries) {
  const byDate = new Map();
  for (const entry of entries) {
    if (validDate(entry.date) && Number.isFinite(entry.weightKg) && entry.weightKg > 0) byDate.set(entry.date, entry);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function round(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function rollingWeightSeries(entries) {
  const sorted = validReadings(entries);
  return sorted.map(entry => {
    const currentDay = dayNumber(entry.date);
    const window = sorted.filter(candidate => {
      const age = currentDay - dayNumber(candidate.date);
      return age >= 0 && age < 7;
    });
    return {
      ...entry,
      trendKg: window.length >= 2
        ? round(window.reduce((sum, item) => sum + item.weightKg, 0) / window.length, 2)
        : null
    };
  });
}

function regressionSlope(entries) {
  const points = entries.map(entry => ({ x: dayNumber(entry.date), y: entry.weightKg }));
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const numerator = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  return denominator === 0 ? 0 : numerator / denominator;
}

function windowEvidence(entries) {
  if (entries.length < 4) return null;
  const span = dayNumber(entries.at(-1).date) - dayNumber(entries[0].date);
  if (span < 9 || entries.some((entry, index) => index && dayNumber(entry.date) - dayNumber(entries[index - 1].date) > 5)) return null;
  const slope = regressionSlope(entries);
  const firstDay = dayNumber(entries[0].date);
  const intercept = entries.reduce((sum, entry) => sum + entry.weightKg - slope * (dayNumber(entry.date) - firstDay), 0) / entries.length;
  const rmsKg = Math.sqrt(entries.reduce((sum, entry) => {
    const residual = entry.weightKg - intercept - slope * (dayNumber(entry.date) - firstDay);
    return sum + residual ** 2;
  }, 0) / entries.length);
  const meanKg = entries.reduce((sum, entry) => sum + entry.weightKg, 0) / entries.length;
  if (rmsKg > Math.max(0.35, meanKg * 0.005)) return null;
  return {
    startDate: entries[0].date,
    endDate: entries.at(-1).date,
    count: entries.length,
    percentPerWeek: round((-slope * 7 / meanKg) * 100, 2),
    variabilityKg: round(rmsKg, 3)
  };
}

export function buildAdjustmentRecommendation(entries, targets, now = new Date()) {
  const sorted = validReadings(entries);
  if (sorted.length < 8) return null;
  const elapsedDays = dayNumber(sorted.at(-1).date) - dayNumber(sorted[0].date);
  if (elapsedDays < 21) return null;
  const latestDay = dayNumber(sorted.at(-1).date);
  const latestAge = dayNumber(localDate(now)) - latestDay;
  if (latestAge < 0 || latestAge > 7) return null;
  const recent = windowEvidence(sorted.filter(entry => latestDay - dayNumber(entry.date) < 14));
  const previous = windowEvidence(sorted.filter(entry => {
    const age = latestDay - dayNumber(entry.date);
    return age >= 14 && age < 28;
  }));
  if (!recent || !previous
    || dayNumber(recent.startDate) - dayNumber(previous.endDate) > 5
    || Math.abs(recent.percentPerWeek - previous.percentPerWeek) > 0.35) return null;
  const observedPercentPerWeek = round((recent.percentPerWeek + previous.percentPerWeek) / 2, 2);
  const [lower, upper] = PACE_BANDS[targets.pace] ?? PACE_BANDS.moderate;
  const basis = { startDate: previous.startDate, endDate: recent.endDate, previous, recent,
    observedPercentPerWeek, targetContext: { pace: targets.pace,
      averageCalories: targets.averageCalories, bmr: targets.bmr } };
  if (recent.percentPerWeek < lower && previous.percentPerWeek < lower) {
    if (targets.averageCalories - 100 < targets.bmr) return null;
    return { changeCalories: -100, observedPercentPerWeek, reason: 'slowerThanSelectedPace', basis };
  }
  if (recent.percentPerWeek > upper && previous.percentPerWeek > upper) {
    return { changeCalories: 100, observedPercentPerWeek, reason: 'fasterThanSelectedPace', basis };
  }
  return null;
}

export function progressSummary(endDate, data, periodDays) {
  if (!validDate(endDate) || ![7, 30].includes(periodDays)) throw new TypeError('A valid date and 7 or 30 days are required');
  const end = dayNumber(endDate);
  const dates = Array.from({ length: periodDays }, (_, index) =>
    new Date((end - (periodDays - index - 1)) * DAY_MS).toISOString().slice(0, 10));
  const days = dates.map(date => dailySummary(date, data)).filter(day => day.items.length > 0);
  const completeCalories = days.filter(day => day.calories.complete && Number.isFinite(day.nutrients.calories));
  const completeProtein = days.filter(day => {
    const detail = day.details.protein;
    return detail.unknownItems.length === 0 && Number.isFinite(detail.total);
  });
  const average = (items, value) => items.length
    ? round(items.reduce((sum, item) => sum + value(item), 0) / items.length, 1)
    : null;
  const nutrients = Object.fromEntries(NUTRIENTS.map(definition => {
    const complete = days.filter(day => {
      const detail = day.details[definition.id];
      return detail.unknownItems.length === 0 && Number.isFinite(detail.total);
    });
    const countState = state => complete.filter(day => day.details[definition.id].state === state).length;
    return [definition.id, {
      label: definition.label,
      completeDays: complete.length,
      loggedDays: days.length,
      metDays: countState('met'),
      highDays: countState('high'),
      inProgressDays: countState('inProgress'),
      average: average(complete, day => day.details[definition.id].total),
      unit: definition.unit
    }];
  }));
  return {
    periodDays,
    endDate,
    calories: { average: average(completeCalories, day => day.nutrients.calories),
      completeDays: completeCalories.length, loggedDays: days.length },
    protein: { average: average(completeProtein, day => day.details.protein.total),
      completeDays: completeProtein.length, loggedDays: days.length,
      metDays: nutrients.protein.metDays },
    nutrients
  };
}
