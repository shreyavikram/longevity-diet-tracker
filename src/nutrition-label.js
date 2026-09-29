// Reads the text of a US Nutrition Facts or Supplement Facts panel (from on-device text recognition or
// text copied from a photo) into exact per-serving values. No AI is involved. Values are only what the
// panel prints: "less than" amounts are left unknown and explicit zeros stay known zeros.
const UNIT_FAMILY = { g: 'g', mg: 'mg', mq: 'mg', mcg: 'mcg', mecg: 'mcg', meg: 'mcg', imeg: 'mcg', µg: 'mcg', μg: 'mcg', ug: 'mcg', iu: 'iu' };
const TO_UNIT = {
  g: { g: 1, mg: 0.001, mcg: 0.000001 },
  mg: { g: 1000, mg: 1, mcg: 0.001 },
  mcg: { g: 1000000, mg: 1000, mcg: 1 }
};

// Each nutrient: its app key, how the panel names it, and the unit the app stores it in.
const FIELDS = [
  ['fatG', /(?:total\s+fat|(?<![a-z]\s)(?<![a-z])fat(?!\s*,)(?=[^\n\d]{0,12}\d))/, 'g'],
  ['saturatedFatG', /(?:saturated|sat\.)\s*fat/, 'g'],
  ['transFatG', /trans\.?\s*fat/, 'g'],
  ['totalSugarG', /total\s+sugars?/, 'g'],
  ['sodiumMg', /sodium/, 'mg'],
  ['carbsG', /(?:total\s+)?carb(?:ohydrates?|s|\.)?(?!\w)/, 'g'],
  ['fiberG', /(?<!soluble\s{0,3})(?:dietary\s+)?fib(?:er|re)/, 'g'],
  ['solubleFiberG', /(?<!in)soluble\s*fib(?:er|re)/, 'g'],
  ['proteinG', /protein/, 'g'],
  ['calciumMg', /calcium/, 'mg'],
  ['ironMg', /\biron/, 'mg'],
  ['potassiumMg', /potas(?:sium|\.)/, 'mg'],
  ['b12Mcg', /vit(?:amin|\.)?\s*b\s*-?\s*12/, 'mcg'],
  ['zincMg', /zinc/, 'mg'],
  ['iodineMcg', /[il]odine/, 'mcg'],
  ['seleniumMcg', /selenium/, 'mcg'],
  ['magnesiumMg', /magnesium/, 'mg'],
  ['folateDfeMcg', /folate/, 'mcg'],
  ['cholineMg', /choline/, 'mg']
];
const AMOUNT = String.raw`[^\n\d<]{0,40}?(<\s*)?(\d[\d,]*(?:\.\d+)?)\s*(mcg|mecg|imeg|meg|µg|μg|ug|mg|mq|g|iu)\b`;
// Gram amounts as text recognition often returns them: the "g" read as "9" ("Protein 159") or dropped ("Fiber 5").
const BARE_AMOUNT = String.raw`[^\n\d<]{0,40}?(<\s*)?(\d[\d,]*(?:\.\d+)?)(?![\d.]|\s*(?:mcg|meg|µg|μg|ug|mg|mq|g|iu)\b)`;

const toNumber = text => Number(String(text).replace(/,/g, ''));

function amountAfter(text, name) {
  const match = new RegExp(`${name.source}${AMOUNT}`, 'i').exec(text);
  if (!match || match[1]) return null;
  return { value: toNumber(match[2]), raw: match[2], unit: UNIT_FAMILY[match[3].toLowerCase()], end: match.index + match[0].length };
}

// Current US label Daily Values, in the same units the app stores. A printed percentage is useful independent
// evidence when text recognition drops a tiny decimal point (for example 2.2 mg becoming 22 mg).
const DAILY_VALUE = {
  fatG: 78, saturatedFatG: 20, sodiumMg: 2300, carbsG: 275, fiberG: 28, proteinG: 50,
  calciumMg: 1300, ironMg: 18, potassiumMg: 4700, b12Mcg: 2.4, zincMg: 11,
  iodineMcg: 150, seleniumMcg: 55, magnesiumMg: 420, folateDfeMcg: 400, cholineMg: 550,
  vitDMcg: 20
};

function dailyValueAfter(text, end) {
  const line = text.slice(end, text.indexOf('\n', end) < 0 ? text.length : text.indexOf('\n', end));
  const match = /(\d[\d,]*(?:\.\d+)?)\s*%/.exec(line);
  return match ? toNumber(match[1]) : null;
}

function correctedByDailyValue(key, value, raw, text, end) {
  const reference = DAILY_VALUE[key];
  const percent = dailyValueAfter(text, end);
  if (!reference || !Number.isFinite(percent) || percent <= 0 || !Number.isFinite(value) || value <= 0) return value;
  if (percent > 100) return value;
  const error = candidate => Math.abs(candidate / reference * 100 - percent);
  const tolerance = Math.max(5, percent * 0.25);
  if (error(value) <= tolerance) return value;
  // Only repair the two errors observed from the bundled reader: one dropped decimal place, or a final
  // character appended to an otherwise intact integer. Wider searches can turn a misread percentage into
  // a plausible-looking but fabricated amount.
  const candidates = [value / 10];
  const digits = String(raw).replace(/,/g, '');
  if (/^\d{3,}$/.test(digits)) candidates.push(Number(digits.slice(0, -1)));
  const best = candidates.filter(candidate => candidate > 0)
    .sort((left, right) => error(left) - error(right))[0];
  if (best && error(best) <= tolerance && error(best) < error(value) / 4) return best;
  // Preserve a plausible printed amount when the percentage is the part OCR likely damaged. Only leave the
  // amount unknown when it is both unusually large and irreconcilable with a small printed Daily Value.
  return value > reference * 1.5 && percent < 100 ? null : value;
}

// For a gram field with no readable unit: the number as printed, and (when it ends in 9) the number with that
// "9" treated as a misread "g". The first option is the more likely one.
function bareGramOptions(text, name) {
  const match = new RegExp(`${name.source}${BARE_AMOUNT}`, 'i').exec(text);
  if (!match || match[1]) return null;
  const digits = match[2].replace(/,/g, '');
  const stripped = /^\d*\.?\d+9$/.test(digits) && digits.length > 1 ? Number(digits.slice(0, -1)) : null;
  return stripped === null ? [Number(digits)] : [stripped, Number(digits)];
}

const MACRO_KCAL = { fatG: 9, carbsG: 4, proteinG: 4 };

// Picks, for fat, carbs, and protein read without a unit, the readings that best add up to the printed calories.
function resolveMacros(nutrients, options) {
  const keys = Object.keys(options).filter(key => key in MACRO_KCAL);
  let best = null;
  const walk = (index, chosen) => {
    if (index === keys.length) {
      const values = { ...nutrients, ...chosen };
      const kcal = Object.entries(MACRO_KCAL).reduce((sum, [key, factor]) => sum + (values[key] ?? 0) * factor, 0);
      const preference = keys.reduce((sum, key) => sum + options[key].indexOf(chosen[key]), 0);
      const error = Number.isFinite(nutrients.calories) ? Math.abs(kcal - nutrients.calories) : 0;
      if (!best || error < best.error - 1e-9 || (Math.abs(error - best.error) < 1e-9 && preference < best.preference)) best = { error, preference, chosen };
      return;
    }
    for (const value of options[keys[index]]) walk(index + 1, { ...chosen, [keys[index]]: value });
  };
  walk(0, {});
  return best?.chosen ?? {};
}

// Nutrition numbers written into a description ("30g protein", "fat: 5 g", "250 calories"). These are what
// the person says they ate, so they override every other source. A food amount ("1 protein bar", "100g tofu")
// is not a nutrition number: a gram nutrient needs its unit written after the number, or a colon after its name.
const STATED = [
  ['calories', String.raw`kcals?|cals?|calories?`, 'kcal'],
  ['saturatedFatG', String.raw`sat(?:urated|\.)?\s+fat`, 'g'],
  ['fatG', String.raw`(?<!sat\s|sat\.\s|saturated\s|trans\s)(?:total\s+)?fat`, 'g'],
  ['proteinG', String.raw`protein`, 'g'],
  ['carbsG', String.raw`(?:total\s+)?carb(?:ohydrate)?s?`, 'g'],
  ['fiberG', String.raw`(?:dietary\s+)?fib(?:er|re)`, 'g'],
  ['addedSugarG', String.raw`added\s+sugars?`, 'g'],
  ['sodiumMg', String.raw`sodium`, 'mg'],
  ['ironMg', String.raw`iron`, 'mg'],
  ['calciumMg', String.raw`calcium`, 'mg'],
  ['potassiumMg', String.raw`potassium`, 'mg'],
  ['zincMg', String.raw`zinc`, 'mg'],
  ['magnesiumMg', String.raw`magnesium`, 'mg'],
  ['b12Mcg', String.raw`(?:vitamin\s+)?b-?12`, 'mcg']
];
const STATED_UNITS = { g: 'g', gram: 'g', grams: 'g', gm: 'g', mg: 'mg', milligram: 'mg', milligrams: 'mg',
  mcg: 'mcg', µg: 'mcg', μg: 'mcg', ug: 'mcg', microgram: 'mcg', micrograms: 'mcg' };
const STATED_UNIT = String.raw`(grams?|gm|g|milligrams?|mg|micrograms?|mcg|µg|μg|ug)\b`;
const STATED_NUMBER = String.raw`(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|\.\d+)`;

function statedValue(key, unit, number, writtenUnit) {
  const value = toNumber(number);
  if (!Number.isFinite(value) || value < 0) return null;
  if (unit === 'kcal') return value;
  const from = STATED_UNITS[String(writtenUnit ?? unit).toLowerCase()];
  const factor = from && TO_UNIT[unit][from];
  return factor ? Number((value * factor).toPrecision(6)) : null;
}

function statedMatches(text, numberFirst) {
  const found = [];
  for (const [key, name, unit] of STATED) {
    const pattern = numberFirst
      ? unit === 'kcal'
        ? new RegExp(String.raw`(?<![\w.,])${STATED_NUMBER}\s*(${name})\b`, 'gi')
        : new RegExp(String.raw`(?<![\w.,])${STATED_NUMBER}\s*${STATED_UNIT}\s*(?:of\s+)?(?:${name})\b`, 'gi')
      : new RegExp(String.raw`\b(?:${name})\b\s*[:=]?\s*${STATED_NUMBER}(?:\s*${unit === 'kcal' ? String.raw`(kcals?|cals?|calories?)\b` : STATED_UNIT})?(?![\w.])`, 'gi');
    for (const match of text.matchAll(pattern)) {
      const writtenUnit = numberFirst ? (unit === 'kcal' ? null : match[2]) : match[2];
      const separated = !numberFirst && /[:=]/.test(match[0].slice(0, match[0].search(/\d/)));
      // "protein 20" with no unit or colon is too easily a count; it needs "20g" or "protein: 20".
      if (!numberFirst && unit !== 'kcal' && !writtenUnit && !separated) continue;
      const value = statedValue(key, unit, match[1], writtenUnit);
      if (value !== null) found.push({ key, value, start: match.index, end: match.index + match[0].length });
    }
  }
  return found;
}

export function statedNutrientsFromText(input) {
  const text = String(input ?? '');
  if (!/\d/.test(text)) return {};
  // Written as "20g protein" or as "protein 20g": the reading that explains more of the text decides the
  // ambiguous numbers, and the other only adds nutrients that do not overlap it.
  const numberFirst = statedMatches(text, true);
  const nameFirst = statedMatches(text, false);
  const [primary, secondary] = nameFirst.length > numberFirst.length ? [nameFirst, numberFirst] : [numberFirst, nameFirst];
  const chosen = [...primary];
  for (const match of secondary) {
    if (!chosen.some(other => match.start < other.end && other.start < match.end)) chosen.push(match);
  }
  const stated = {};
  for (const match of chosen.sort((left, right) => left.start - right.start)) stated[match.key] ??= match.value;
  return stated;
}

export function parseNutritionLabel(input) {
  const text = String(input ?? '').replace(/[•·|]/g, '\n').replace(/[ \t]+/g, ' ')
    // A narrow second "1" is sometimes read as "i" immediately before a microgram unit ("11mcg" → "1imecg").
    .replace(/(\d)i(?=m(?:e)?cg\b)/gi, (_match, digit) => `${digit}1`);
  const kind = /supplement\s+facts/i.test(text) ? 'supplement'
    : /nutrition(?:al)?\s+(?:facts|info(?:rmation)?)|amount\s+per\s+serving|%\s*daily\s+value/i.test(text) ? 'nutrition' : null;
  const repairsDailyValues = kind === 'nutrition';
  const nutrients = {};
  const corrected = [];

  const calories = /calories\s*:?\s*(\d[\d,]*)/i.exec(text);
  if (calories) nutrients.calories = toNumber(calories[1]);

  const gramOptions = {};
  for (const [key, name, unit] of FIELDS) {
    const amount = amountAfter(text, name);
    const headed = !amount && new RegExp(`${name.source}[^\\n\\d]{0,12}\\((mcg|mg|g)\\)[^\\n\\d<]{0,20}(\\d[\\d,]*(?:\\.\\d+)?)`, 'i').exec(text);
    if (headed && TO_UNIT[unit][headed[1].toLowerCase()]) {
      nutrients[key] = Number((toNumber(headed[2]) * TO_UNIT[unit][headed[1].toLowerCase()]).toPrecision(6));
      continue;
    }
    if (!amount && unit === 'g') {
      const options = bareGramOptions(text, name);
      if (options) gramOptions[key] = options;
      continue;
    }
    if (!amount || amount.unit === 'iu' || !TO_UNIT[unit][amount.unit]) continue;
    const read = Number((amount.value * TO_UNIT[unit][amount.unit]).toPrecision(6));
    const value = repairsDailyValues ? correctedByDailyValue(key, read, amount.raw, text, amount.end) : read;
    if (value === null) continue;
    nutrients[key] = Number(value.toPrecision(6));
    if (value !== read) corrected.push(key);
  }
  // Total fat's pattern also matches "Saturated Fat ... Total"; only the macro search needs protecting here.
  Object.assign(nutrients, resolveMacros(nutrients, gramOptions));
  for (const [key, options] of Object.entries(gramOptions)) if (!(key in MACRO_KCAL)) nutrients[key] = options[0];
  corrected.push(...Object.keys(gramOptions));

  const added = /includes\s+(<\s*)?(\d+(?:\.\d+)?)\s*g\s+added\s+sugars?/i.exec(text) ?? /added\s+sugars?\s+(<\s*)?(\d+(?:\.\d+)?)\s*g/i.exec(text);
  if (added && !added[1]) nutrients.addedSugarG = toNumber(added[2]);

  // Vitamin D: prefer a printed IU amount, otherwise convert micrograms (1 mcg = 40 IU).
  const vitaminD = amountAfter(text, /vit(?:amin|\.)?\s*d\s*[23]?/);
  if (vitaminD) {
    const iu = /^[^\n]{0,30}?\(?\s*(\d[\d,]*(?:\.\d+)?)\s*iu\b/i.exec(text.slice(vitaminD.end));
    if (vitaminD.unit === 'iu') nutrients.vitDIu = vitaminD.value;
    else if (iu) nutrients.vitDIu = toNumber(iu[1]);
    else if (vitaminD.unit === 'mcg') {
      const value = repairsDailyValues ? correctedByDailyValue('vitDMcg', vitaminD.value, vitaminD.raw, text, vitaminD.end) : vitaminD.value;
      if (value !== null) {
        nutrients.vitDIu = value * 40;
        if (value !== vitaminD.value) corrected.push('vitDIu');
      }
    }
    else if (vitaminD.unit === 'mg') nutrients.vitDIu = vitaminD.value * 40000;
  }

  const macros = ['fatG', 'carbsG', 'proteinG'].filter(key => key in nutrients).length;
  // With a label heading, anything read counts (the review shows what is missing); without one, it takes
  // calories and two macros to tell a label from a description of a meal.
  const isLabel = kind ? Object.keys(nutrients).length > 0 : Number.isFinite(nutrients.calories) && macros >= 2;
  if (!isLabel) return null;

  const serving = /serving\s+size\s*:?\s*([^\n]+)/i.exec(text);
  const servingLabel = serving ? serving[1].trim().replace(/\s+/g, ' ') : null;
  const grams = servingLabel ? /(\d+(?:\.\d+)?)\s*g\b/i.exec(servingLabel) ?? /\((\d+)9\)/.exec(servingLabel) : null;
  return { kind: kind ?? 'nutrition', servingLabel, servingGrams: grams ? Number(grams[1]) : null, nutrients, corrected };
}

// The ingredient list printed with a label ("Ingredients: oats, brown rice syrup, ..."), or null. Used only as
// evidence for the free-sugar split and trans-fat warnings; it never changes the panel's numbers.
export function extractIngredients(input) {
  const match = /\bingredients?\s*[:;.]?\s*([\s\S]+?)(?=\n\s*\n|\b(?:contains|allergen|may contain|distributed by|manufactured|nutrition facts|supplement facts)\b|$)/i.exec(String(input ?? ''));
  const list = match?.[1].replace(/\s+/g, ' ').trim();
  return list && list.length >= 3 ? list.slice(0, 2000) : null;
}
