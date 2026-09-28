// Reads the text of a US Nutrition Facts or Supplement Facts panel (from on-device text recognition or
// text copied from a photo) into exact per-serving values. No AI is involved. Values are only what the
// panel prints: "less than" amounts are left unknown and explicit zeros stay known zeros.
const UNIT_FAMILY = { g: 'g', mg: 'mg', mcg: 'mcg', µg: 'mcg', μg: 'mcg', ug: 'mcg', iu: 'iu' };
const TO_UNIT = {
  g: { g: 1, mg: 0.001, mcg: 0.000001 },
  mg: { g: 1000, mg: 1, mcg: 0.001 },
  mcg: { g: 1000000, mg: 1000, mcg: 1 }
};

// Each nutrient: its app key, how the panel names it, and the unit the app stores it in.
const FIELDS = [
  ['fatG', /total\s+fat/, 'g'],
  ['saturatedFatG', /(?:saturated|sat\.)\s*fat/, 'g'],
  ['sodiumMg', /sodium/, 'mg'],
  ['carbsG', /total\s+carb(?:ohydrates?|s|\.)?/, 'g'],
  ['fiberG', /dietary\s+fib(?:er|re)/, 'g'],
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
const AMOUNT = String.raw`[^\n\d<]{0,40}?(<\s*)?(\d[\d,]*(?:\.\d+)?)\s*(mcg|µg|μg|ug|mg|g|iu)\b`;

const toNumber = text => Number(String(text).replace(/,/g, ''));

function amountAfter(text, name) {
  const match = new RegExp(`${name.source}${AMOUNT}`, 'i').exec(text);
  if (!match || match[1]) return null;
  return { value: toNumber(match[2]), unit: UNIT_FAMILY[match[3].toLowerCase()], end: match.index + match[0].length };
}

export function parseNutritionLabel(input) {
  const text = String(input ?? '').replace(/[•·|]/g, '\n').replace(/[ \t]+/g, ' ');
  const kind = /supplement\s+facts/i.test(text) ? 'supplement' : /nutrition\s+facts/i.test(text) ? 'nutrition' : null;
  const nutrients = {};

  const calories = /calories\s*:?\s*(\d[\d,]*)/i.exec(text);
  if (calories) nutrients.calories = toNumber(calories[1]);

  for (const [key, name, unit] of FIELDS) {
    const amount = amountAfter(text, name);
    if (!amount || amount.unit === 'iu' || !TO_UNIT[unit][amount.unit]) continue;
    nutrients[key] = Number((amount.value * TO_UNIT[unit][amount.unit]).toPrecision(6));
  }

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
  const isLabel = kind === 'supplement' ? Object.keys(nutrients).length > 0
    : Number.isFinite(nutrients.calories) && (macros >= 2 || (kind === 'nutrition' && macros >= 1));
  if (!isLabel) return null;

  const serving = /serving\s+size\s*:?\s*([^\n]+)/i.exec(text);
  const servingLabel = serving ? serving[1].trim().replace(/\s+/g, ' ') : null;
  const grams = servingLabel ? /(\d+(?:\.\d+)?)\s*g\b/i.exec(servingLabel) : null;
  return { kind: kind ?? 'nutrition', servingLabel, servingGrams: grams ? Number(grams[1]) : null, nutrients };
}
