// Workout days published from Lift (activity.json next to the app) set training days automatically.
// A day the user toggled by hand keeps their choice; only days this sync marked are ever un-marked.
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const isWorkout = value => value && typeof value === 'object' && !Array.isArray(value)
  && typeof value.name === 'string' && value.name.length <= 80
  && (value.minutes === null || (Number.isInteger(value.minutes) && value.minutes >= 0 && value.minutes <= 600));

export function parseActivity(text) {
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  if (!parsed || parsed.version !== 1 || parsed.source !== 'lift' || typeof parsed.generatedAt !== 'string'
    || !parsed.days || typeof parsed.days !== 'object' || Array.isArray(parsed.days)) return null;
  for (const [date, workouts] of Object.entries(parsed.days)) {
    if (!DATE.test(date) || !Array.isArray(workouts) || !workouts.length || !workouts.every(isWorkout)) return null;
  }
  return parsed;
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function mergeActivity(dayState, activity) {
  const next = structuredClone(dayState ?? {});
  for (const [date, workouts] of Object.entries(activity.days)) {
    const day = next[date] ?? {};
    const manual = day.trainingSource === 'manual' || (day.trainingDay !== undefined && day.trainingSource !== 'lift');
    next[date] = manual
      ? { ...day, workouts: structuredClone(workouts) }
      : { ...day, trainingDay: true, trainingSource: 'lift', workouts: structuredClone(workouts) };
  }
  for (const [date, day] of Object.entries(next)) {
    if (activity.days[date] || !day.workouts) continue;
    const { workouts, trainingSource, ...rest } = day;
    next[date] = trainingSource === 'lift' ? { ...rest, trainingDay: false } : { ...rest, ...(trainingSource ? { trainingSource } : {}) };
  }
  return { dayState: next, changed: !same(next, dayState ?? {}) };
}
