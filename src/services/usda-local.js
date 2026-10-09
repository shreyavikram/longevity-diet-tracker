// Searches the on-device copy of USDA's generic foods (data/usda-foods.json, built by scripts/build-usda.mjs),
// so everyday lookups need no network, key, or rate limit. Results use the same shape as live USDA results.
const STOP_WORDS = new Set(['and', 'with', 'the', 'for', 'plain', 'fresh', 'food', 'foods']);
const clean = text => String(text ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
const reportsFiber = food => Number(Number.isFinite(food.values?.fiberG));
const words = text => clean(text).split(' ').filter(word => word.length > 2 && !STOP_WORDS.has(word));

export function createLocalFoodSearch({ fetchFn = globalThis.fetch, url = './data/usda-foods.json' } = {}) {
  let loading = null;

  function load() {
    loading ??= Promise.resolve()
      .then(() => fetchFn(url))
      .then(response => response?.ok ? response.json() : null)
      .then(data => data?.version === 1 ? data.foods.map(([fdcId, description, type, values]) => ({
        fdcId,
        filledFrom: data.filled?.[fdcId],
        description,
        dataType: data.types[type] ?? type,
        text: ` ${clean(description)} `,
        values: Object.fromEntries(data.keys.map((key, index) => [key, values[index]]).filter(([, value]) => Number.isFinite(value)))
      })) : null)
      .catch(() => null)
      .then(foods => {
        if (!foods) loading = null;
        return foods;
      });
    return loading;
  }

  // minShare 1 returns only records containing every search word; lower values allow looser matches.
  return async function search(query, { limit = 8, minShare = 1 } = {}) {
    const foods = await load();
    if (!foods) return null;
    const wanted = words(query);
    if (!wanted.length) return [];
    const needed = Math.max(1, Math.ceil(wanted.length * minShare));
    return foods
      .map(food => ({ food, matched: wanted.filter(word => food.text.includes(` ${word}`)).length }))
      .filter(item => item.matched >= needed)
      // Between equal matches, a record that reports fiber comes first (her choice, 2026-10-08).
      .sort((left, right) => right.matched - left.matched || reportsFiber(right.food) - reportsFiber(left.food)
        || left.food.description.length - right.food.description.length)
      .slice(0, limit)
      .map(({ food }) => ({ fdcId: food.fdcId, description: food.description, dataType: food.dataType, brand: '',
        servingSize: null, servingSizeUnit: null, servingLabel: null, basis: 'per100g', values: { ...food.values },
        retrievedAt: 'On-device USDA copy', publishedAt: null, ...(food.filledFrom ? { filledFrom: { ...food.filledFrom } } : {}) }));
  };
}
