// Each Lift workout earns its own calories (her request, 2026-10-27, spec
// docs/superpowers/specs/2026-10-27-workout-calories-design.md). Only what a workout burns above sitting counts,
// (MET − 1) × kg × hours, so nothing double-counts the everyday baseline, and every rate is the low end of
// published values: she asked never to overestimate. Part of the estimate goes on the workout's own evening and
// the rest on the next day, since she trains at night.

export const WORKOUT_ENERGY = Object.freeze({
  setMinutes: 3,
  compoundMet: 5.0,
  liftingMet: 3.5,
  stretchMet: 2.3,
  holdMet: 3.5,
  runKmh: 8,
  runKcalPerKgKm: 1.0,
  walkKcalPerKgKm: 0.5,
  // Compendium of Physical Activities, lowest-effort value for each machine. Checked in order: battle before rope.
  machineMets: Object.freeze([[/battle/i, 6.0], [/cycl|bike/i, 3.5], [/row/i, 4.8], [/ellip/i, 5.0], [/stair/i, 6.0], [/jump|skip/i, 8.3]]),
  otherCardioMet: 3.5,
  compoundEquip: Object.freeze(['barbell', 'smith']),
  compoundMuscles: Object.freeze(['glutes', 'quads', 'hamstrings', 'back'])
});

const FOOT = /run|walk|jog|treadmill/i;
const E = WORKOUT_ENERGY;
const positive = value => Number.isFinite(value) && value > 0;
const netKcal = (met, weightKg, seconds) => (met - 1) * weightKg * seconds / 3600;

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function nextDate(date) {
  const [year, month, day] = date.split('-').map(Number);
  return localDate(new Date(year, month - 1, day + 1));
}

export function workoutDate(workout) {
  return localDate(new Date(workout.startedAt));
}

export function estimateWorkout(workout, { weightKg }) {
  const elapsed = workout.endedAt ? (Date.parse(workout.endedAt) - Date.parse(workout.startedAt)) / 60000 : null;
  const minutes = Number.isFinite(elapsed) ? Math.max(0, elapsed) : null;
  let compoundSets = 0, otherSets = 0, stretchSeconds = 0, holdSeconds = 0, cardioSeconds = 0;
  const cardio = [];
  for (const entry of workout.entries ?? []) {
    const machine = { name: entry.name, meters: 0, seconds: 0, kcal: 0 };
    for (const set of entry.sets ?? []) {
      if (set.type === 'W') continue;
      if (entry.mode === 'stretch') stretchSeconds += positive(set.durationS) ? set.durationS : 0;
      else if ((entry.muscle === 'cardio' || entry.mode === 'distdur') && positive(set.durationS)) {
        if (positive(set.distanceM) && FOOT.test(`${entry.name} ${entry.exerciseId}`)) {
          const km = set.distanceM / 1000;
          machine.kcal += km * weightKg * (km / (set.durationS / 3600) >= E.runKmh ? E.runKcalPerKgKm : E.walkKcalPerKgKm);
          machine.meters += set.distanceM;
        } else {
          const met = (E.machineMets.find(([pattern]) => pattern.test(entry.name ?? '')) ?? [null, E.otherCardioMet])[1];
          machine.kcal += netKcal(met, weightKg, set.durationS);
        }
        machine.seconds += set.durationS;
        cardioSeconds += set.durationS;
      } else if ((entry.mode === 'dur' || entry.mode === 'durw') && entry.muscle !== 'cardio') {
        holdSeconds += positive(set.durationS) ? set.durationS : 0;
      } else if (E.compoundEquip.includes(entry.equip) && E.compoundMuscles.includes(entry.muscle)) compoundSets += 1;
      else otherSets += 1; // includes kettlebell swings and sled pushes, which log no time
    }
    if (machine.seconds) cardio.push(machine);
  }

  // Each set stands for its work and the rest after it, but never more time than the workout had for lifting.
  const setMinutes = (compoundSets + otherSets) * E.setMinutes;
  const available = minutes === null ? Infinity : Math.max(0, minutes - (cardioSeconds + stretchSeconds + holdSeconds) / 60);
  const scale = setMinutes > 0 ? Math.min(1, available / setMinutes) : 0;
  const liftingKcal = netKcal(E.compoundMet, weightKg, compoundSets * E.setMinutes * scale * 60)
    + netKcal(E.liftingMet, weightKg, otherSets * E.setMinutes * scale * 60);
  const stretchKcal = netKcal(E.stretchMet, weightKg, stretchSeconds);
  const holdKcal = netKcal(E.holdMet, weightKg, holdSeconds);

  const parts = [];
  if (compoundSets + otherSets) parts.push({ kind: 'lifting', sets: compoundSets + otherSets, minutes: Math.round(setMinutes * scale), kcal: Math.round(liftingKcal) });
  for (const machine of cardio) {
    parts.push({ kind: 'cardio', name: machine.name, km: machine.meters ? Math.round(machine.meters / 100) / 10 : null,
      minutes: Math.round(machine.seconds / 60), kcal: Math.round(machine.kcal) });
  }
  if (stretchSeconds) parts.push({ kind: 'stretch', minutes: Math.round(stretchSeconds / 60), kcal: Math.round(stretchKcal) });
  if (holdSeconds) parts.push({ kind: 'hold', minutes: Math.round(holdSeconds / 60), kcal: Math.round(holdKcal) });
  const total = liftingKcal + stretchKcal + holdKcal + cardio.reduce((sum, machine) => sum + machine.kcal, 0);
  return { kcal: Math.floor(total / 5) * 5, minutes: minutes === null ? null : Math.round(minutes), parts };
}

// The calories a date earns from workouts: up to sameNightKcal of each workout on its own evening, the rest of it
// the next day. The two parts never add up to more than the estimate.
export function workoutCredits(workouts, date, { sameNightKcal, weightKgOn }) {
  const items = [];
  for (const workout of workouts ?? []) {
    const day = workoutDate(workout);
    const when = day === date ? 'sameNight' : nextDate(day) === date ? 'nextDay' : null;
    if (!when) continue;
    const estimate = estimateWorkout(workout, { weightKg: weightKgOn(day) });
    const sameNight = Math.min(Math.max(0, sameNightKcal), estimate.kcal);
    const kcal = when === 'sameNight' ? sameNight : estimate.kcal - sameNight;
    if (kcal > 0) items.push({ workoutId: workout.id, name: workout.name, workoutDate: day, when, kcal, estimate });
  }
  return { total: items.reduce((sum, item) => sum + item.kcal, 0), items };
}
