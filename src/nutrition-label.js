// Reads the text of a US Nutrition Facts or Supplement Facts panel (from on-device text recognition or
// text copied from a photo) into exact per-serving values. No AI is involved. Values are only what the
// panel prints: "less than" amounts are left unknown and explicit zeros stay known zeros.
const UNIT_FAMILY = { g: 'g', mg: 'mg', mq: 'mg', mcg: 'mcg', meg: 'mcg', µg: 'mcg', μg: 'mcg', ug: 'mcg', iu: 'iu' };
const TO_UNIT = {
  g: { g: 1, mg: 0.001, mcg: 0.000001 },
  mg: { g: 1000, mg: 1, mcg: 0.001 },
  mcg: { g: 1000000, mg: 1000, mcg: 1 }
};

// Each nutrient: its app key, how the panel names it, and the unit the app stores it in.
const FIELDS = [
  ['fatG', /(?:total\s+fat|(?<![a-z]\s)(?<![a-z])fat(?!\s*,)(?=[^\n\d]{0,12}\d))/, 'g'],
  ['saturatedFatG', /(?:saturated|sat\.)\s*fat/, 'g'],
  ['sodiumMg', /sodium/, 'mg'],
  ['carbsG', /(?:total\s+)?carb(?:ohydrates?|s|\.)?(?!\w)/, 'g'],
  ['fiberG', /(?:dietary\s+)?fib(?:er|re)/, 'g'],
  ['proteinG', /protein/, 'g'],
  ['calciumMg', /calcium/, 'mg'],
  ['ironMg', /\biron/, 'mg'],
  ['potassiumMg', /potas(?:sium|\.)/, 'mg'],
  ['b12Mcg', /vit(?:amin|\.)?\s*b\s*-?\s*12/, 'mcg'],
  ['zincMg', /zinc/, 'mg'],
  ['iodineMcg', /iodine/, 'mcg'],
  ['seleniumMcg', /selenium/, 'mcg'],
  ['magnesiumMg', /magnesium/, 'mg'],
  ['folateDfeMcg', /folate/, 'mcg'],
  ['cholineMg', /choline/, 'mg']
];
const AMOUNT = String.raw`[^\n\d<]{0,40}?(<\s*)?(\d[\d,]*(?:\.\d+)?)\s*(mcg|meg|µg|μg|ug|mg|mq|g|iu)\b`;
// Gram amounts as text recognition often returns them: the "g" read as "9" ("Protein 159") or dropped ("Fiber 5").
const BARE_AMOUNT = String.raw`[^\n\d<]{0,40}?(<\s*)?(\d[\d,]*(?:\.\d+)?)(?![\d.]|\s*(?:mcg|meg|µg|μg|ug|mg|mq|g|iu)\b)`;

const toNumber = text => Number(String(text).replace(/,/g, ''));

function amountAfter(text, name) {
  const match = new RegExp(`${name.source}${AMOUNT}`, 'i').exec(text);
  if (!match || match[1]) return null;
  return { value: toNumber(match[2]), unit: UNIT_FAMILY[match[3].toLowerCase()], end: match.index + match[0].length };
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

export function parseNutritionLabel(input) {
  const text = String(input ?? '').replace(/[•·|]/g, '\n').replace(/[ \t]+/g, ' ');
  const kind = /supplement\s+facts/i.test(text) ? 'supplement'
    : /nutrition(?:al)?\s+(?:facts|info(?:rmation)?)|amount\s+per\s+serving|%\s*daily\s+value/i.test(text) ? 'nutrition' : null;
  const nutrients = {};

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
    nutrients[key] = Number((amount.value * TO_UNIT[unit][amount.unit]).toPrecision(6));
  }
  // Total fat's pattern also matches "Saturated Fat ... Total"; only the macro search needs protecting here.
  Object.assign(nutrients, resolveMacros(nutrients, gramOptions));
  for (const [key, options] of Object.entries(gramOptions)) if (!(key in MACRO_KCAL)) nutrients[key] = options[0];
  const corrected = Object.keys(gramOptions);

  const added = /includes\s+(<\s*)?(\d+(?:\.\d+)?)\s*g\s+added\s+sugars?/i.exec(text) ?? /added\s+sugars?\s+(<\s*)?(\d+(?:\.\d+)?)\s*g/i.exec(text);
  if (added && !added[1]) nutrients.addedSugarG = toNumber(added[2]);

  // Vitamin D: prefer a printed IU amount, otherwise convert micrograms (1 mcg = 40 IU).
  const vitaminD = amountAfter(text, /vit(?:amin|\.)?\s*d\s*[23]?/);
  if (vitaminD) {
    const iu = /^[^\n]{0,30}?\(?\s*(\d[\d,]*(?:\.\d+)?)\s*iu\b/i.exec(text.slice(vitaminD.end));
    if (vitaminD.unit === 'iu') nutrients.vitDIu = vitaminD.value;
    else if (iu) nutrients.vitDIu = toNumber(iu[1]);
    else if (vitaminD.unit === 'mcg') nutrients.vitDIu = vitaminD.value * 40;
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
