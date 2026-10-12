// Built-in presets on Add (her request, 2026-10-05): Silk soymilks and the US Huel Black Edition shakes, Black Edition
// bottles, and Hot & Savory pouches, typed from the makers' published Nutrition Facts panels (retrieved 2026-10-05).
// Every value is a printed label value. Omega-3 is from Huel's "Additional Facts" (flaxseed, so ALA); for the
// bottles it is Huel's formula page figure. Silk prints no selenium, zinc, or choline, so those stay unknown.
// The Huel Complete Nutrition Bar (her request, 2026-10-10) prints no omega-3, so ALA stays unknown; its maltitol
// is kept as sugar alcohol.
import { NUTRIENTS } from './constants.js';
import { deriveSugarBreakdown } from './sugar.js';
import { buildItemGlycemic, matchGiEvidence } from './glycemic.js';

const RETRIEVED = '2026-10-05';
const SOURCES = Object.freeze({
  silk: 'https://silk.com/plant-based-products/soymilk/',
  powder: 'https://huel.com/products/huel-black-edition',
  rtd: 'https://huel.com/products/huel-black-edition-ready-to-drink',
  hs: 'https://huel.com/products/hot-and-savoury-meal-packs',
  bar: 'https://huel.com/products/huel-bar/chocolate-chip-cookie-dough'
});
const RETRIEVED_BY_GROUP = Object.freeze({ bar: '2026-10-10' });
// Column order of each row after its name and serving: label units (vitamin D in mcg, omega-3 in g).
const COLUMNS = ['calories', 'fatG', 'saturatedFatG', 'transFatG', 'sodiumMg', 'carbsG', 'fiberG', 'totalSugarG',
  'addedSugarG', 'proteinG', 'vitDMcg', 'ironMg', 'calciumMg', 'potassiumMg', 'b12Mcg', 'folateDfeMcg', 'magnesiumMg',
  'seleniumMcg', 'iodineMcg', 'zincMg', 'cholineMg', 'alaG', 'sugarAlcoholG'];

const ROWS = {
  silk: [
    ['Silk Organic Unsweet Soymilk', '1 cup (240 mL)', 80, 3.5, 0.5, 0, 80, 5, 2, 1, 0, 8, 3, 1, 280, 300, 2.4, 40, 35, null, 15, null, null, null],
    ['Silk Original Soymilk', '1 cup (240 mL)', 110, 4.5, 0.5, 0, 90, 8, 2, 5, 4, 8, 3, 1, 470, 370, 2.4, 40, 40, null, 15, null, null, null],
  ],
  powder: [
    ['Chocolate', '2 scoops (90 g)', 400, 17, 3.5, 0, 400, 28, 11, 3, 3, 40, 4, 8.4, 390, 1320, 0.8, 81, 156, 57, 30, 5.9, 118, 5],
    ['Vanilla', '2 scoops (90 g)', 400, 16, 3, 0, 340, 28, 9, 1, 0, 40, 4, 5.8, 400, 980, 0.8, 80, 122, 60, 30, 5.6, 118, 6],
    ['Banana', '2 scoops (90 g)', 400, 16, 3, 0, 340, 28, 9, 1, 0, 40, 4, 5.8, 400, 990, 0.8, 80, 122, 60, 30, 5.6, 118, 5.5],
    ['Chocolate Peanut Butter', '2 scoops (90 g)', 400, 16, 3.5, 0, 450, 29, 10, 3, 1, 40, 4, 7.4, 400, 1160, 0.8, 81, 138, 60, 30, 5.6, 118, 4],
    ['Strawberry', '2 scoops (90 g)', 400, 17, 3, 0, 340, 27, 9, 2, 0, 40, 4, 6.2, 400, 990, 0.8, 80, 122, 60, 30, 5.6, 118, 5.5],
    ['Strawberry Banana', '2 scoops (90 g)', 390, 15, 4, 0, 350, 28, 9, 1, 0, 40, 4, 7.4, 400, 1160, 0.8, 81, 138, 60, 30, 5.6, 118, 4.5],
    ['Salted Caramel', '2 scoops (90 g)', 400, 17, 3, 0, 370, 27, 9, 4, 3, 40, 4, 6.1, 400, 1030, 0.8, 80, 126, 60, 30, 5.6, 118, 5.5],
    ['Unflavored & Unsweetened', '2 scoops (90 g)', 400, 18, 3, 0, 330, 24, 9, 0.5, 0, 40, 4, 5.8, 400, 980, 0.8, 80, 122, 60, 30, 5.6, 118, 5],
    ['Cookies & Cream', '2 scoops (90 g)', 400, 16, 3, 0, 400, 28, 9, 4, 2, 40, 4, 6.7, 390, 1100, 0.8, 80, 133, 60, 30, 5.7, 118, 5.5],
    ['Coffee Caramel', '2 scoops (90 g)', 400, 16, 3, 0, 340, 28, 9, 4, 2, 40, 4, 5.8, 400, 990, 0.8, 80, 122, 60, 30, 5.6, 118, 5.5],
    ['Cinnamon Roll', '2 scoops (90 g)', 400, 16, 3, 0, 340, 27, 9, 4, 2, 40, 4, 5.8, 400, 990, 0.8, 80, 122, 60, 30, 5.6, 118, 5.5],
  ],
  rtd: [
    ['Strawberry Banana', '1 bottle (500 mL)', 390, 17, 5, 0, 340, 28, 6, 4, 3, 35, 5, 5, 300, 990, 0.8, 80, 120, 32, 30, 4.4, 140, 2],
    ['Mixed Berry', '1 bottle (500 mL)', 390, 17, 5, 0, 340, 28, 6, 4, 3, 35, 5, 5, 300, 990, 0.8, 80, 120, 32, 30, 4.4, 140, 2],
    ['Chocolate', '1 bottle (500 mL)', 400, 17, 6, 0, 380, 30, 7, 6, 4, 35, 5, 9, 260, 1000, 0.8, 80, 120, 24, 70, 4, 140, 2],
    ['Vanilla', '1 bottle (500 mL)', 400, 17, 6, 0, 312, 29, 6, 6, 4, 35, 5, 9, 260, 940, 0.8, 80, 100, 24, 70, 4, 140, 2],
    ['Chocolate Peanut Butter', '1 bottle (500 mL)', 400, 18, 6, 0, 400, 29, 7, 6, 4, 35, 5, 9, 260, 940, 0.8, 80, 100, 24, 70, 4, 140, 2],
    ['Cookies & Cream', '1 bottle (500 mL)', 400, 17, 6, 0, 320, 29, 7, 6, 4, 35, 5, 9, 260, 980, 0.8, 80, 100, 24, 70, 4, 140, 2],
    ['Iced Coffee', '1 bottle (500 mL)', 400, 17, 6, 0, 320, 29, 6, 5, 4, 35, 5, 9, 260, 940, 0.8, 80, 90, 20, 70, 4, 140, 2],
  ],
  hs: [
    ['Cajun Pasta', '1 pouch (103 g)', 400, 10, 2.5, 0, 640, 55, 5, 10, 9, 24, 4, 4.4, 260, 940, 0.8, 80, 84, 11, 30, 2, 110, 2],
    ["Chick'n & Mushroom Pasta", '1 pouch (103 g)', 400, 9, 3, 0, 580, 60, 5, 4, 1, 24, 4, 5.2, 260, 940, 0.8, 80, 86, 13, 60, 2.7, 125, 1.5],
    ['Yellow Coconut Curry', '1 pouch (107 g)', 400, 7, 2, 0, 490, 62, 7, 5, 4, 25, 4, 4, 260, 940, 1.6, 80, 94, 18, 30, 3, 60, 1.5],
    ['Szechuan Spiced Noodles', '1 pouch (106 g)', 400, 7, 1, 0, 560, 64, 5, 5, 2, 22, 4, 4.8, 260, 1060, 0.8, 80, 88, 11, 30, 2.2, 110, 2.5],
    ['Thai Noodles', '1 pouch (105 g)', 400, 8, 1, 0, 570, 63, 5, 11, 8, 22, 4, 4.8, 260, 1080, 0.8, 80, 85, 11, 30, 2.2, 110, 2],
    ['Thai Green Curry', '1 pouch (107 g)', 400, 9, 3, 0, 480, 61, 8, 7, 4, 24, 4, 4, 260, 940, 1.6, 80, 94, 18, 30, 3, 60, 1.5],
    ['Spicy Indian Curry', '1 pouch (109 g)', 400, 7, 2, 0, 530, 63, 8, 5, 3, 25, 4, 4, 260, 940, 1.6, 80, 94, 18, 30, 3, 60, 1.5],
    ['Mexican Chili', '1 pouch (108 g)', 400, 8, 1.5, 0, 530, 62, 10, 7, 4, 24, 4, 3.6, 260, 940, 1.6, 80, 94, 18, 30, 2.6, 60, 2],
    ['Mac & Cheeze', '1 pouch (101 g)', 400, 9, 3, 0, 510, 56, 3, 2, 0, 25, 4, 5.4, 280, 940, 1.2, 110, 110, 14, 30, 3.2, 110, 1.5],
    ['Pasta Bolognese', '1 pouch (106 g)', 400, 9, 1, 0, 550, 59, 5, 10, 1, 24, 4, 5, 260, 960, 0.8, 80, 90, 11, 30, 2.6, 110, 2],
    ['Japanese Curry Noodles', '1 pouch (101 g)', 400, 11, 5, 0, 590, 57, 7, 7, 3, 22, 4, 3.6, 300, 940, 0.8, 80, 92, 11, 30, 2.2, 110, 2],
    ['Korean BBQ Noodles', '1 pouch (107 g)', 400, 8, 1, 0, 540, 64, 6, 8, 5, 22, 4, 4.6, 260, 1200, 0.8, 80, 90, 11, 30, 2.2, 110, 2],
    ['Spicy Gochujang Noodles', '1 pouch (107 g)', 400, 8, 1, 0, 580, 64, 6, 5, 2, 22, 4, 4.6, 260, 1320, 0.8, 80, 90, 11, 30, 2.2, 110, 2],
  ],
  bar: [
    ['Chocolate Chip Cookie Dough', '1 bar (55 g)', 190, 7, 3, 0, 45, 27, 7, 2, 0, 13, 2.1, 2.1, 130, 470, 0.4, 40, 62, 8.2, 23, 1.5, 54, null, 12],
  ],
};

const GROUPS = Object.freeze([
  { id: 'silk', label: 'Silk soymilk', name: name => name.includes('Unsweet') ? `${name} (green carton)` : `${name} (red carton)`,
    fluidMl: 240, classification: name => name.includes('Unsweet') ? 'unsweetenedSoy' : 'sweetenedDairySoy' },
  { id: 'powder', label: 'Huel Black Edition shakes (powder)', name: name => `Huel Black Edition ${name} shake`, fluidMl: 500,
    classification: () => 'composite', note: 'Made with 500 mL (about 2 cups) of water, as the label directs. Change the water amount if you mixed it with something else.' },
  { id: 'rtd', label: 'Huel Black Edition bottles', name: name => `Huel Black Edition ${name} bottle`, fluidMl: 500,
    classification: () => 'composite' },
  { id: 'hs', label: 'Huel Hot & Savory pouches', name: name => `Huel Hot & Savory ${name}`, fluidMl: null,
    classification: () => 'composite' },
  { id: 'bar', label: 'Huel bars', name: name => `Huel Complete Nutrition Bar ${name}`, fluidMl: null,
    classification: () => 'composite' }
]);

// GI (her request, 2026-10-05). Huel's lab results (Oxford Brookes, listed at HUEL_GI_URL) are used where that product
// was tested; every other Huel product gets her chosen estimate, carried over from the tested products most like it
// (the same base: rice, wheat pasta or noodles, or the shake formula), with the tested range as its range. GL is then
// GI times each product's own available carbs, so it is never copied from another product. Silk uses the soy milk
// entry in the International GI Tables.
const HUEL_GI_URL = 'https://huel.com/pages/what-is-glycemic-index-and-load';
const tested = (value, what, confidence = 'high') => ({ value, range: { min: value, max: value }, sourceType: 'manufacturer-test',
  sourceName: 'Huel GI testing (Oxford Brookes)', sourceUrl: HUEL_GI_URL, referenceName: what, preparation: 'lab tested', confidence });
const estimated = (value, min, max, what) => ({ value, range: { min, max }, sourceType: 'estimate',
  sourceName: 'Estimate from Huel GI tests', sourceUrl: HUEL_GI_URL, referenceName: what, preparation: 'estimated', confidence: 'low' });
const RICE = ['Thai Green Curry', 'Mexican Chili', 'Yellow Coconut Curry', 'Spicy Indian Curry'];
const PASTA = ['Mac & Cheeze', 'Cajun Pasta', "Chick'n & Mushroom Pasta", 'Pasta Bolognese'];
function giEvidence(groupId, name) {
  if (groupId === 'silk') return matchGiEvidence({ name: 'soy milk', preparation: 'drink' });
  if (groupId === 'powder') return tested(19, 'Huel Black Edition powder, tested 2020 (flavor not stated)', 'medium');
  if (groupId === 'bar') return tested(19, 'Huel Complete Nutrition Bar, tested 2024 (flavor not stated)', 'medium');
  if (groupId === 'rtd') return estimated(25, 19, 30, 'Huel Black Edition powder (19) and Huel Ready-to-drink (25, 30)');
  if (name === 'Thai Green Curry') return tested(19, 'Huel Hot & Savory Thai Green Curry, tested 2021');
  if (name === 'Mexican Chili') return tested(31, 'Huel Hot & Savory Mexican Chili, tested 2021');
  if (name === 'Mac & Cheeze') return tested(34, 'Huel Hot & Savory Mac & Cheeze, tested 2021');
  if (RICE.includes(name)) return estimated(25, 19, 31, 'Huel rice meals Thai Green Curry (19) and Mexican Chili (31)');
  if (PASTA.includes(name)) return estimated(29, 23, 34, 'Huel pasta meals Mac & Cheeze (34) and Tomato & Herb (23)');
  return estimated(29, 19, 34, 'Huel wheat pasta meals (23, 34); no noodle meal was tested');
}

const slug = text => text.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const GROUP_OF = Object.fromEntries(NUTRIENTS.map(definition => [definition.key, definition.group]));

function buildItem(group, [rawName, servingLabel, ...values]) {
  const flat = {};
  const provenance = {};
  const retrieved = RETRIEVED_BY_GROUP[group.id] ?? RETRIEVED;
  const record = { source: 'label', confidence: 'high', sourceUrl: SOURCES[group.id], retrievedAt: retrieved };
  COLUMNS.forEach((column, index) => {
    const value = values[index];
    if (!Number.isFinite(value)) return;
    const key = column === 'vitDMcg' ? 'vitDIu' : column;
    flat[key] = column === 'vitDMcg' ? value * 40 : value;
    provenance[key] = key === 'alaG' && group.id === 'rtd' ? { ...record, confidence: 'medium' } : { ...record };
  });
  const classification = group.classification(rawName);
  const sugar = deriveSugarBreakdown({ nutrients: flat, provenance, classification });
  const perServing = {};
  for (const [key, value] of Object.entries(sugar.nutrients)) {
    if (GROUP_OF[key]) (perServing[GROUP_OF[key]] ??= {})[key] = value;
    else perServing[key] = value;
  }
  const assumptions = [`Printed Nutrition Facts for ${servingLabel}, from ${SOURCES[group.id]} (retrieved ${retrieved}).`];
  if (group.note) assumptions.push(group.note);
  if (values[COLUMNS.indexOf('totalSugarG')] === 0.5) assumptions.push('The label says less than 1 g of total sugar, stored as 0.5 g.');
  return {
    id: `preset-${group.id}-${slug(rawName)}`,
    presetGroup: group.id,
    shortName: group.id === 'silk' ? group.name(rawName) : rawName,
    type: 'packaged',
    name: group.name(rawName),
    servingLabel,
    perServing,
    provenance: sugar.provenance,
    classification,
    glycemic: buildItemGlycemic({ components: [{ name: group.name(rawName), nutrients: { carbsG: flat.carbsG, fiberG: flat.fiberG },
      gi: giEvidence(group.id, rawName) }], perServing: flat }),
    confidence: 'high',
    assumptions,
    components: [],
    favorite: false,
    verified: true,
    ...(group.fluidMl ? { fluidMl: group.fluidMl } : {})
  };
}

const LABEL_GROUPS = GROUPS.map(group => ({
  id: group.id,
  label: group.label,
  items: ROWS[group.id].map(row => buildItem(group, row))
}));

// Her recipes (her request, 2026-10-12). Each ingredient amount times a USDA record from the on-device copy
// (data/usda-foods.json, per 100 g), or times a printed label: Silk Unsweet (the preset above, her carton) and Golden
// Barrel blackstrap molasses (label values as transcribed by the maker's FAQ and nutrition sites, so medium
// confidence). Like an analyzed recipe, a nutrient some ingredient does not report keeps its known part, marked
// partial with the ingredient named; calories are reported by every ingredient. The molasses is the only free sugar.
const USDA_COPY = 'On-device USDA copy';
const USDA = {
  wholeWheatFlour: [168893, 'SR Legacy', { calories: 340, proteinG: 13.2, carbsG: 72, fatG: 2.5, fiberG: 10.7, saturatedFatG: 0.43,
    totalSugarG: 0.41, b12Mcg: 0, calciumMg: 34, cholineMg: 31.2, epaDhaMg: 0, folateDfeMcg: 44, ironMg: 3.6, magnesiumMg: 137,
    potassiumMg: 363, seleniumMcg: 61.8, sodiumMg: 2, vitDIu: 0, zincMg: 2.6 }],
  groundFlaxseed: [2262075, 'Foundation', { calories: 514, proteinG: 18, carbsG: 34.4, fatG: 37.3, fiberG: 23.1, saturatedFatG: 3.28,
    alaG: 19.4, calciumMg: 230, ironMg: 5.78, magnesiumMg: 372, potassiumMg: 793, seleniumMcg: 136, sodiumMg: 36.7, zincMg: 4.74 }],
  oliveOil: [171413, 'SR Legacy', { calories: 884, proteinG: 0, carbsG: 0, fatG: 100, fiberG: 0, saturatedFatG: 13.8, totalSugarG: 0,
    b12Mcg: 0, calciumMg: 1, cholineMg: 0.3, epaDhaMg: 0, folateDfeMcg: 0, ironMg: 0.56, magnesiumMg: 0, potassiumMg: 1,
    seleniumMcg: 0, sodiumMg: 2, vitDIu: 0, zincMg: 0 }],
  blueberries: [173950, 'SR Legacy', { calories: 51, proteinG: 0.42, carbsG: 12.2, fatG: 0.64, fiberG: 2.7, saturatedFatG: 0.053,
    transFatG: 0, totalSugarG: 8.45, b12Mcg: 0, calciumMg: 8, cholineMg: 5.1, epaDhaMg: 0, folateDfeMcg: 7, ironMg: 0.18,
    magnesiumMg: 5, potassiumMg: 54, seleniumMcg: 0.1, sodiumMg: 1, vitDIu: 0, zincMg: 0.07 }],
  cocoa: [169593, 'SR Legacy', { calories: 228, proteinG: 19.6, carbsG: 57.9, fatG: 13.7, fiberG: 37, saturatedFatG: 8.07,
    totalSugarG: 1.75, b12Mcg: 0, calciumMg: 128, cholineMg: 12, epaDhaMg: 0, folateDfeMcg: 32, ironMg: 13.9, magnesiumMg: 499,
    potassiumMg: 1520, seleniumMcg: 14.3, sodiumMg: 21, vitDIu: 0, zincMg: 6.81 }],
  cinnamon: [171320, 'SR Legacy', { calories: 247, proteinG: 3.99, carbsG: 80.6, fatG: 1.24, fiberG: 53.1, saturatedFatG: 0.345,
    transFatG: 0, totalSugarG: 2.17, alaG: 0.011, b12Mcg: 0, calciumMg: 1000, cholineMg: 11, epaDhaMg: 0, folateDfeMcg: 6,
    ironMg: 8.32, magnesiumMg: 60, potassiumMg: 431, seleniumMcg: 3.1, sodiumMg: 10, vitDIu: 0, zincMg: 1.83 }],
  salt: [173468, 'SR Legacy', { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, saturatedFatG: 0, transFatG: 0, totalSugarG: 0,
    b12Mcg: 0, calciumMg: 24, cholineMg: 0, epaDhaMg: 0, folateDfeMcg: 0, ironMg: 0.33, magnesiumMg: 1, potassiumMg: 8,
    seleniumMcg: 0.1, sodiumMg: 38800, vitDIu: 0, zincMg: 0.1 }],
  bakingPowder: [172803, 'SR Legacy', { calories: 53, proteinG: 0, carbsG: 27.7, fatG: 0, fiberG: 0.2, saturatedFatG: 0, totalSugarG: 0,
    b12Mcg: 0, calciumMg: 5880, cholineMg: 0, epaDhaMg: 0, folateDfeMcg: 0, ironMg: 11, magnesiumMg: 27, potassiumMg: 20,
    seleniumMcg: 0.2, sodiumMg: 10600, vitDIu: 0, zincMg: 0.01 }],
  bakingSoda: [175040, 'SR Legacy', { calories: 0, proteinG: 0, carbsG: 0, fatG: 0, fiberG: 0, saturatedFatG: 0, totalSugarG: 0,
    b12Mcg: 0, calciumMg: 0, cholineMg: 0, epaDhaMg: 0, folateDfeMcg: 0, ironMg: 0, magnesiumMg: 0, potassiumMg: 0,
    seleniumMcg: 0.2, sodiumMg: 27400, vitDIu: 0, zincMg: 0 }],
  ciderVinegar: [173469, 'SR Legacy', { calories: 21, proteinG: 0, carbsG: 0.93, fatG: 0, fiberG: 0, saturatedFatG: 0, transFatG: 0,
    totalSugarG: 0.4, b12Mcg: 0, calciumMg: 7, cholineMg: 0, epaDhaMg: 0, folateDfeMcg: 0, ironMg: 0.2, magnesiumMg: 5,
    potassiumMg: 73, seleniumMcg: 0.1, sodiumMg: 5, vitDIu: 0, zincMg: 0.04 }]
};
const MOLASSES = { name: 'Golden Barrel blackstrap molasses', servingLabel: '1 tbsp (21 g)',
  sourceUrl: 'https://www.goldenbarrel.com/frequently-asked-questions-about-golden-barrel-molasses/', retrievedAt: '2026-10-12',
  values: { calories: 60, fatG: 0, saturatedFatG: 0, transFatG: 0, sodiumMg: 25, carbsG: 14, fiberG: 0, totalSugarG: 11, proteinG: 1,
    calciumMg: 203, ironMg: 3, potassiumMg: 466, magnesiumMg: 42 } };

const SILK_UNSWEET_ID = 'preset-silk-silk-organic-unsweet-soymilk';
const usda = (key, name, amount, grams) => ({ kind: 'usda', key, name, amount, grams });
const silk = (amount, servings) => ({ kind: 'silk', name: 'Silk Organic Unsweet Soymilk', amount, servings });
const molasses = (amount, servings) => ({ kind: 'molasses', name: 'Blackstrap molasses', amount, servings });

const RECIPES = [
  { id: 'whole-wheat-blueberry-pancakes', name: 'Whole wheat blueberry pancakes', servings: 2,
    servingLabel: '1/2 batch (3 to 4 pancakes)', sourceUrl: 'https://sweetpotatosoul.com/whole-wheat-blueberry-pancakes/',
    note: 'Sweet Potato Soul\'s recipe made her way: whole wheat flour, blackstrap molasses instead of sugar, ground flaxseed, Silk Unsweet, and olive oil in the batter and the pan.',
    ingredients: [
      usda('wholeWheatFlour', 'Whole wheat flour', '1 1/4 cups', 150),
      molasses('2 tbsp', 2),
      usda('groundFlaxseed', 'Ground flaxseed (flax meal)', '2 tbsp', 14),
      usda('bakingPowder', 'Baking powder', '1 tsp', 4.6),
      usda('bakingSoda', 'Baking soda', '1 tsp', 4.6),
      usda('salt', 'Salt', '1/4 tsp', 1.5),
      usda('cinnamon', 'Cinnamon', '1 tsp', 2.6),
      silk('1 cup', 1),
      usda('ciderVinegar', 'Apple cider vinegar', '2 tsp', 10),
      usda('oliveOil', 'Olive oil (batter)', '2 tbsp', 27),
      usda('oliveOil', 'Olive oil (pan)', '1 tsp', 4.5),
      usda('blueberries', 'Frozen blueberries', '1 cup', 155)
    ] },
  // About 106 g of sauce; the powders thicken the liquid rather than add their full volume, so a batch is about 6 tbsp.
  { id: 'flax-cocoa-molasses-chocolate-sauce', name: 'Flax cocoa chocolate sauce', servings: 6,
    servingLabel: '1 tbsp (about 1/6 of a batch)', sourceUrl: null,
    note: 'Her recipe: 2 tbsp ground flaxseed, 2 tbsp unsweetened cocoa, 1 tbsp blackstrap molasses, and 1/4 cup Silk Unsweet. A batch is estimated at about 6 tbsp; set servings to 6 for the whole batch.',
    ingredients: [
      usda('groundFlaxseed', 'Ground flaxseed (flax meal)', '2 tbsp', 14),
      usda('cocoa', 'Unsweetened cocoa powder', '2 tbsp', 10.8),
      molasses('1 tbsp', 1),
      silk('1/4 cup', 0.25)
    ] }
];

const LABEL_ITEMS = LABEL_GROUPS.flatMap(group => group.items);
const flatValues = perServing => Object.fromEntries(Object.entries({ ...perServing, ...(perServing.micros ?? {}) })
  .filter(([key, value]) => key !== 'micros' && key !== 'freeSugarG' && key !== 'intrinsicSugarG' && Number.isFinite(value)));
const CONFIDENCE_RANK = { low: 0, medium: 1, high: 2 };

// One ingredient's values for the whole batch, with the record each came from.
function ingredientValues(ingredient) {
  if (ingredient.kind === 'usda') {
    const [fdcId, dataType, per100] = USDA[ingredient.key];
    return { values: Object.fromEntries(Object.entries(per100).map(([key, value]) => [key, value * ingredient.grams / 100])),
      record: { source: 'usda', confidence: 'medium', sourceId: String(fdcId), dataType, retrievedAt: USDA_COPY } };
  }
  if (ingredient.kind === 'silk') {
    const carton = LABEL_ITEMS.find(item => item.id === SILK_UNSWEET_ID);
    return { values: Object.fromEntries(Object.entries(flatValues(carton.perServing)).map(([key, value]) => [key, value * ingredient.servings])),
      record: { source: 'label', confidence: 'high', sourceUrl: SOURCES.silk, retrievedAt: RETRIEVED, productId: SILK_UNSWEET_ID },
      gi: carton.glycemic.components[0].gi };
  }
  return { values: Object.fromEntries(Object.entries(MOLASSES.values).map(([key, value]) => [key, value * ingredient.servings])),
    record: { source: 'label', confidence: 'medium', sourceUrl: MOLASSES.sourceUrl, retrievedAt: MOLASSES.retrievedAt } };
}

function buildRecipe(recipe) {
  const parts = recipe.ingredients.map(ingredient => ({ ingredient, ...ingredientValues(ingredient) }));
  const flat = {};
  const provenance = {};
  const keys = new Set(parts.flatMap(part => Object.keys(part.values)));
  for (const key of keys) {
    const reporting = parts.filter(part => Number.isFinite(part.values[key]));
    const contributors = reporting.map(part => ({ ...part.record, componentIndex: parts.indexOf(part),
      componentName: part.ingredient.name, amount: part.values[key] / recipe.servings }));
    flat[key] = contributors.reduce((sum, contributor) => sum + contributor.amount, 0);
    const source = contributors.every(contributor => contributor.source === contributors[0].source) ? contributors[0].source : 'mixed';
    const confidence = contributors.reduce((low, contributor) =>
      CONFIDENCE_RANK[contributor.confidence] < CONFIDENCE_RANK[low] ? contributor.confidence : low, 'high');
    provenance[key] = { source, confidence, contributors,
      ...(reporting.length < parts.length ? { partial: true,
        missingFrom: parts.filter(part => !reporting.includes(part)).map(part => part.ingredient.name) } : {}) };
  }
  // Molasses sugar is free sugar (a syrup) and FDA added sugar; every other ingredient's sugar is intrinsic.
  const molassesSugar = parts.filter(part => part.ingredient.kind === 'molasses')
    .reduce((sum, part) => sum + part.values.totalSugarG / recipe.servings, 0);
  const molassesRecord = { source: 'label', confidence: 'medium', sourceUrl: MOLASSES.sourceUrl, retrievedAt: MOLASSES.retrievedAt };
  flat.addedSugarG = molassesSugar;
  provenance.addedSugarG = { ...molassesRecord, reasons: ['Only the blackstrap molasses is added sugar'] };
  flat.freeSugarG = molassesSugar;
  provenance.freeSugarG = { ...molassesRecord, method: 'food-rule', classification: 'composite',
    reasons: ['Only the blackstrap molasses adds free sugar'] };
  const sugar = deriveSugarBreakdown({ nutrients: flat, provenance, classification: 'composite' });
  const perServing = {};
  for (const [key, value] of Object.entries(sugar.nutrients)) {
    if (GROUP_OF[key]) (perServing[GROUP_OF[key]] ??= {})[key] = value;
    else perServing[key] = value;
  }
  const amounts = recipe.ingredients.map(ingredient => `${ingredient.amount} ${ingredient.name.toLowerCase()}${ingredient.grams ? ` (${ingredient.grams} g)` : ''}`);
  const assumptions = [recipe.note,
    `One batch: ${amounts.join(', ')}. Divided into ${recipe.servings} servings.`,
    'USDA values come from the on-device copy; Silk is its printed label; the molasses is Golden Barrel\'s label (another brand of blackstrap is close but not identical).',
    ...(recipe.sourceUrl ? [`Recipe: ${recipe.sourceUrl}`] : [])];
  return {
    id: `preset-recipe-${recipe.id}`,
    presetGroup: 'recipe',
    shortName: recipe.name,
    type: 'recipe',
    name: recipe.name,
    servingLabel: recipe.servingLabel,
    perServing,
    provenance: sugar.provenance,
    classification: 'composite',
    glycemic: buildItemGlycemic({ perServing: flat, components: parts.map(part => ({ name: part.ingredient.name,
      nutrients: { carbsG: part.values.carbsG / recipe.servings, fiberG: part.values.fiberG / recipe.servings },
      gi: part.gi ?? matchGiEvidence({ name: part.ingredient.name }) })) }),
    confidence: 'medium',
    assumptions,
    components: [],
    favorite: false,
    verified: true
  };
}

export const PRESET_GROUPS = Object.freeze([...LABEL_GROUPS, { id: 'recipe', label: 'My recipes', items: RECIPES.map(buildRecipe) }]
  .map(group => Object.freeze({ ...group, items: Object.freeze(group.items.map(item => Object.freeze(item))) })));

export function findPreset(id) {
  for (const group of PRESET_GROUPS) {
    const item = group.items.find(candidate => candidate.id === id);
    if (item) return structuredClone(item);
  }
  return null;
}
