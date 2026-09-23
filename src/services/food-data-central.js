import { AnalysisError } from './anthropic.js';
import { MACRO_NUTRIENTS, NUTRIENTS } from '../constants.js';

const CANONICAL = new Set([...MACRO_NUTRIENTS, ...NUTRIENTS].map(item => item.key));
const NUTRIENT_ID_MAP = new Map([
  [1008, ['calories', 'KCAL']], [2047, ['calories', 'KCAL']], [2048, ['calories', 'KCAL']],
  [1003, ['proteinG', 'G']], [1005, ['carbsG', 'G']], [1004, ['fatG', 'G']], [1079, ['fiberG', 'G']],
  [1258, ['saturatedFatG', 'G']], [1235, ['addedSugarG', 'G']], [1087, ['calciumMg', 'MG']],
  [1089, ['ironMg', 'MG']], [1090, ['magnesiumMg', 'MG']], [1092, ['potassiumMg', 'MG']],
  [1093, ['sodiumMg', 'MG']], [1095, ['zincMg', 'MG']], [1103, ['seleniumMcg', 'UG']],
  [1100, ['iodineMcg', 'UG']], [1190, ['folateDfeMcg', 'UG']],
  [1178, ['b12Mcg', 'UG']], [1114, ['vitDIu', 'UG']], [1180, ['cholineMg', 'MG']],
  [1404, ['alaG', 'G']], [1272, ['dhaMg', 'G']], [1278, ['epaMg', 'G']]
]);
const NAME_MAP = new Map([
  ['energy', 'calories'], ['protein', 'proteinG'], ['carbohydrate by difference', 'carbsG'],
  ['total lipid fat', 'fatG'], ['total dietary fiber', 'fiberG'], ['fiber total dietary', 'fiberG'],
  ['fatty acids total saturated', 'saturatedFatG'], ['sugars added', 'addedSugarG'],
  ['calcium ca', 'calciumMg'], ['iron fe', 'ironMg'], ['magnesium mg', 'magnesiumMg'],
  ['potassium k', 'potassiumMg'], ['sodium na', 'sodiumMg'], ['zinc zn', 'zincMg'],
  ['selenium se', 'seleniumMcg'], ['iodine i', 'iodineMcg'], ['folate dfe', 'folateDfeMcg'],
  ['vitamin b 12', 'b12Mcg'], ['vitamin d d2 d3', 'vitDIu'], ['vitamin d', 'vitDIu'],
  ['choline total', 'cholineMg'], ['pufa 18 3 n 3 c c c ala', 'alaG'],
  ['alpha linolenic acid ala', 'alaG'], ['alpha linolenic acid', 'alaG'],
  ['pufa 22 6 n 3 dha', 'dhaMg'], ['pufa 20 5 n 3 epa', 'epaMg']
]);
const EXPECTED_UNIT = Object.freeze({ calories: 'KCAL', proteinG: 'G', carbsG: 'G', fatG: 'G', fiberG: 'G', saturatedFatG: 'G', addedSugarG: 'G', calciumMg: 'MG', ironMg: 'MG', magnesiumMg: 'MG', potassiumMg: 'MG', zincMg: 'MG', seleniumMcg: 'UG', iodineMcg: 'UG', folateDfeMcg: 'UG', b12Mcg: 'UG', vitDIu: 'IU', alaG: 'G', epaMg: 'MG', dhaMg: 'MG', cholineMg: 'MG' });
const clean = text => String(text ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const day = () => new Date().toISOString().slice(0, 10);

function nutrientRecord(item) {
  const detail = item.nutrient ?? item;
  const id = Number(detail.id ?? item.nutrientId);
  if (id === 1270) return null;
  const key = NUTRIENT_ID_MAP.get(id)?.[0] ?? NAME_MAP.get(clean(detail.name ?? item.nutrientName));
  const unit = String(detail.unitName ?? item.unitName ?? '').toUpperCase().replace('MCG', 'UG').replace('µG', 'UG');
  const amount = item.amount ?? item.value;
  if ((!CANONICAL.has(key) && key !== 'epaMg' && key !== 'dhaMg') || amount === null || amount === undefined || amount === '' || !Number.isFinite(Number(amount)) || Number(amount) < 0) return null;
  const expected = EXPECTED_UNIT[key];
  let value = Number(amount);
  if (unit === expected) return [key, value];
  if (unit === 'UG' && key === 'vitDIu') value *= 40;
  else if (unit === 'MG' && key === 'vitDIu') value *= 40000;
  else if (unit === 'G' && expected === 'MG') value *= 1000;
  else if (unit === 'MG' && expected === 'UG') value *= 1000;
  else if (unit === 'UG' && expected === 'MG') value /= 1000;
  else return null;
  return [key, value];
}

export function normalizeFood(food, retrievedAt = day()) {
  const values = {};
  const omega = {};
  for (const item of food.foodNutrients ?? []) {
    const entry = nutrientRecord(item);
    if (!entry) continue;
    if (entry[0] === 'epaMg' || entry[0] === 'dhaMg') omega[entry[0]] = entry[1];
    else values[entry[0]] = entry[1];
  }
  if (Object.hasOwn(omega, 'epaMg') && Object.hasOwn(omega, 'dhaMg')) values.epaDhaMg = omega.epaMg + omega.dhaMg;
  const servingSize = Number(food.servingSize);
  const servingUnit = String(food.servingSizeUnit ?? '').toLowerCase();
  const basis = food.nutrientBasis === 'perServing' ? 'perServing' : 'per100g';
  return {
    fdcId: food.fdcId,
    description: String(food.description ?? ''),
    dataType: String(food.dataType ?? ''),
    brand: String(food.brandOwner ?? food.brandName ?? ''),
    servingSize: Number.isFinite(servingSize) && servingSize > 0 ? servingSize : null,
    servingSizeUnit: servingUnit || null,
    servingLabel: food.householdServingFullText ?? null,
    basis,
    values,
    retrievedAt,
    publishedAt: food.publicationDate ?? null
  };
}

export async function searchFoods(query, apiKey, fetchFn = globalThis.fetch, { signal } = {}) {
  const url = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
  url.searchParams.set('query', String(query).slice(0, 160));
  url.searchParams.set('api_key', apiKey || 'DEMO_KEY');
  url.searchParams.set('pageSize', '10');
  try {
    const response = await fetchFn(url.toString(), { signal });
    if (!response.ok) throw new AnalysisError(response.status === 429 ? 'rate_limit' : 'usda_service', response.status === 429 ? 'USDA is rate limiting requests. Try again shortly.' : 'USDA food search is unavailable.');
    const payload = await response.json();
    if (!Array.isArray(payload.foods)) throw new AnalysisError('usda_response', 'USDA returned an unreadable food list.');
    return payload.foods.map(item => normalizeFood(item));
  } catch (error) {
    if (error instanceof AnalysisError) throw error;
    if (signal?.aborted || error?.name === 'AbortError') throw new AnalysisError('cancelled', 'Analysis cancelled.');
    throw new AnalysisError('usda_network', 'USDA food search could not connect.');
  }
}

export function rankCandidates(component, foods) {
  const query = clean(component.usdaSearch ?? component.name);
  const words = query.split(' ').filter(word => word.length > 2);
  const packaged = /huel|brand|flavou?r|edition|bar|shake|cereal|packaged|product/i.test(`${component.name} ${component.usdaSearch ?? ''}`);
  return [...foods].sort((left, right) => {
    const score = item => {
      const description = clean(item.description);
      const matches = words.filter(word => description.includes(word)).length;
      const type = item.dataType.toLowerCase();
      return matches * 12 + (description.includes(query) ? 25 : 0)
        + (packaged ? (type === 'branded' ? 30 : 0) : (type === 'foundation' || type === 'sr legacy' || type.includes('fndds') || type.includes('survey') ? 20 : 0))
        + (item.brand && query.includes(clean(item.brand)) ? 20 : 0);
    };
    return score(right) - score(left) || String(left.description).localeCompare(String(right.description));
  });
}
