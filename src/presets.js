// Built-in presets on Add (her request, 2026-10-05): Silk soymilks and the US Huel Black Edition shakes, Black Edition
// bottles, and Hot & Savory pouches, typed from the makers' published Nutrition Facts panels (retrieved 2026-10-05).
// Every value is a printed label value. Omega-3 is from Huel's "Additional Facts" (flaxseed, so ALA); for the
// bottles it is Huel's formula page figure. Silk prints no selenium, zinc, or choline, so those stay unknown.
import { NUTRIENTS } from './constants.js';
import { deriveSugarBreakdown } from './sugar.js';

const RETRIEVED = '2026-10-05';
const SOURCES = Object.freeze({
  silk: 'https://silk.com/plant-based-products/soymilk/',
  powder: 'https://huel.com/products/huel-black-edition',
  rtd: 'https://huel.com/products/huel-black-edition-ready-to-drink',
  hs: 'https://huel.com/products/hot-and-savoury-meal-packs'
});
// Column order of each row after its name and serving: label units (vitamin D in mcg, omega-3 in g).
const COLUMNS = ['calories', 'fatG', 'saturatedFatG', 'transFatG', 'sodiumMg', 'carbsG', 'fiberG', 'totalSugarG',
  'addedSugarG', 'proteinG', 'vitDMcg', 'ironMg', 'calciumMg', 'potassiumMg', 'b12Mcg', 'folateDfeMcg', 'magnesiumMg',
  'seleniumMcg', 'iodineMcg', 'zincMg', 'cholineMg', 'alaG'];

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
};

const GROUPS = Object.freeze([
  { id: 'silk', label: 'Silk soymilk', name: name => name.includes('Unsweet') ? `${name} (green carton)` : `${name} (red carton)`,
    fluidMl: 240, classification: name => name.includes('Unsweet') ? 'unsweetenedSoy' : 'sweetenedDairySoy' },
  { id: 'powder', label: 'Huel Black Edition shake (powder)', name: name => `Huel Black Edition ${name} shake`, fluidMl: 500,
    classification: () => 'composite', note: 'Made with 500 mL (about 2 cups) of water, as the label directs. Change the water amount if you mixed it with something else.' },
  { id: 'rtd', label: 'Huel Black Edition bottle', name: name => `Huel Black Edition ${name} bottle`, fluidMl: 500,
    classification: () => 'composite' },
  { id: 'hs', label: 'Huel Hot & Savory pouch', name: name => `Huel Hot & Savory ${name}`, fluidMl: null,
    classification: () => 'composite' }
]);

const slug = text => text.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const GROUP_OF = Object.fromEntries(NUTRIENTS.map(definition => [definition.key, definition.group]));

function buildItem(group, [rawName, servingLabel, ...values]) {
  const flat = {};
  const provenance = {};
  const record = { source: 'label', confidence: 'high', sourceUrl: SOURCES[group.id], retrievedAt: RETRIEVED };
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
  const assumptions = [`Printed Nutrition Facts for ${servingLabel}, from ${SOURCES[group.id]} (retrieved ${RETRIEVED}).`];
  if (group.note) assumptions.push(group.note);
  if (values[COLUMNS.indexOf('totalSugarG')] === 0.5) assumptions.push('The label says less than 1 g of total sugar, stored as 0.5 g.');
  return {
    id: `preset-${group.id}-${slug(rawName)}`,
    presetGroup: group.id,
    type: 'packaged',
    name: group.name(rawName),
    servingLabel,
    perServing,
    provenance: sugar.provenance,
    classification,
    confidence: 'high',
    assumptions,
    components: [],
    favorite: false,
    verified: true,
    ...(group.fluidMl ? { fluidMl: group.fluidMl } : {})
  };
}

export const PRESET_GROUPS = Object.freeze(GROUPS.map(group => Object.freeze({
  id: group.id,
  label: group.label,
  items: Object.freeze(ROWS[group.id].map(row => Object.freeze(buildItem(group, row))))
})));

export function findPreset(id) {
  for (const group of PRESET_GROUPS) {
    const item = group.items.find(candidate => candidate.id === id);
    if (item) return structuredClone(item);
  }
  return null;
}
