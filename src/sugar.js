// Free and intrinsic sugar. Free sugar follows the WHO definition (sugar added by anyone, plus sugar in honey,
// syrups, juice, and juice concentrate); smoothies count as free and unsweetened dried whole fruit stays
// intrinsic. FDA added sugar stays a separate stored fact. Unknown amounts stay absent, never zero.
export const SUGAR_LEXICON_VERSION = 1;

export const FOOD_CLASSIFICATIONS = Object.freeze([
  { id: 'juice', label: 'Juice' },
  { id: 'juiceConcentrate', label: 'Juice concentrate' },
  { id: 'smoothie', label: 'Smoothie or puréed drink' },
  { id: 'honeySyrup', label: 'Honey or syrup' },
  { id: 'wholeFruit', label: 'Whole fruit' },
  { id: 'vegetable', label: 'Vegetable' },
  { id: 'unsweetenedDriedFruit', label: 'Unsweetened dried fruit' },
  { id: 'sweetenedDriedFruit', label: 'Sweetened dried fruit' },
  { id: 'plainDairy', label: 'Plain dairy' },
  { id: 'unsweetenedSoy', label: 'Unsweetened soy milk or yogurt' },
  { id: 'sweetenedDairySoy', label: 'Sweetened dairy or soy' },
  { id: 'composite', label: 'Mixed or packaged food' },
  { id: 'other', label: 'Other or not sure' }
]);

const FREE_SUGAR_TERMS = Object.freeze([
  'agave nectar', 'agave syrup', 'barley malt syrup', 'malt syrup', 'brown rice syrup', 'rice syrup', 'brown sugar',
  'cane juice', 'evaporated cane juice', 'cane sugar', 'coconut sugar', 'coconut nectar', 'corn syrup',
  'high fructose corn syrup', 'corn syrup solids', 'date syrup', 'maple syrup', 'golden syrup', 'tapioca syrup',
  'invert sugar', 'raw sugar', 'turbinado', 'molasses', 'treacle', 'honey', 'dextrose', 'fructose', 'glucose',
  'sucrose', 'maltose', 'lactose', 'glucose syrup', 'fruit juice concentrate', 'apple juice concentrate',
  'grape juice concentrate', 'pear juice concentrate', 'juice concentrate', 'sugar'
]);
const SUGAR_ALCOHOLS = Object.freeze(['erythritol', 'isomalt', 'lactitol', 'maltitol', 'mannitol', 'sorbitol', 'xylitol']);
const HIGH_INTENSITY = Object.freeze(['stevia', 'steviol glycosides', 'reb m', 'sucralose', 'aspartame', 'acesulfame potassium', 'acesulfame k', 'saccharin', 'monk fruit', 'luo han guo', 'allulose']);
// Phrases that name a sweetener without it being an ingredient.
const NOT_AN_INGREDIENT = /\b(?:no|without|zero)\s+(?:added\s+)?sugars?\b|\bsugars?\s+free\b|\bunsweetened\b|\bsugar\s+snap\b|\bsugar\s+alcohols?\b/g;

const ALL_FREE = new Set(['juice', 'juiceConcentrate', 'smoothie', 'honeySyrup']);
const ALL_INTRINSIC = new Set(['wholeFruit', 'vegetable', 'unsweetenedDriedFruit', 'plainDairy', 'unsweetenedSoy']);
const SPLIT = new Set(['sweetenedDriedFruit', 'sweetenedDairySoy', 'composite']);
const DIRECT = new Set(['label', 'manual']);

const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase()
  .replace(/[-_/]/g, ' ').replace(/[^a-z0-9(),.; ]/g, ' ').replace(/\s+/g, ' ').trim();

// Longest terms claim their text first, so "brown rice syrup" is not also counted as "rice syrup".
function findTerms(text, terms) {
  const claimed = [];
  const found = [];
  for (const term of [...terms].sort((left, right) => right.length - left.length)) {
    const pattern = new RegExp(`(^|[^a-z])(${term.replaceAll(' ', '\\s+')}s?)(?=[^a-z]|$)`, 'g');
    for (const match of text.matchAll(pattern)) {
      const start = match.index + match[1].length;
      const end = start + match[2].length;
      if (claimed.some(([from, to]) => start < to && end > from)) continue;
      claimed.push([start, end]);
      found.push([start, term]);
    }
  }
  return [...new Set(found.sort((left, right) => left[0] - right[0]).map(([, term]) => term))];
}

export function scanIngredientEvidence(text) {
  const normalized = normalize(text);
  const searchable = normalized.replace(NOT_AN_INGREDIENT, match => ' '.repeat(match.length));
  return {
    normalized,
    freeSugarIngredients: findTerms(searchable, FREE_SUGAR_TERMS),
    sugarAlcohols: findTerms(normalized, SUGAR_ALCOHOLS),
    highIntensitySweeteners: findTerms(normalized, HIGH_INTENSITY),
    partiallyHydrogenated: /partially\s+hydrogenated/.test(normalized)
  };
}

export function validateSugarBreakdown(nutrients) {
  const { totalSugarG: total, freeSugarG: free, intrinsicSugarG: intrinsic } = nutrients ?? {};
  return [total, free, intrinsic].every(Number.isFinite) && Math.abs(free + intrinsic - total) > 1e-6
    ? ['sugarSumConflict'] : [];
}

const isDirect = (nutrients, provenance, key) => Number.isFinite(nutrients[key]) && DIRECT.has(provenance[key]?.source);

export function deriveSugarBreakdown(input) {
  const nutrients = structuredClone(input?.nutrients ?? {});
  const provenance = structuredClone(input?.provenance ?? {});
  const classification = input?.classification ?? 'other';
  const ingredientEvidence = scanIngredientEvidence(input?.ingredientsText);
  const hasIngredients = Boolean(ingredientEvidence.normalized);
  const total = nutrients.totalSugarG;
  const added = nutrients.addedSugarG;
  const base = { source: provenance.totalSugarG?.source ?? 'mixed', classification };
  const set = (free, intrinsic, record) => {
    nutrients.freeSugarG = free;
    nutrients.intrinsicSugarG = intrinsic;
    provenance.freeSugarG = record;
    provenance.intrinsicSugarG = { ...record };
  };

  const directFree = isDirect(nutrients, provenance, 'freeSugarG');
  const directIntrinsic = isDirect(nutrients, provenance, 'intrinsicSugarG');
  if (directFree || directIntrinsic) {
    // A person's correction or a printed value wins; only a missing partner is derived by difference.
    if (directFree && !directIntrinsic && Number.isFinite(total)) {
      nutrients.intrinsicSugarG = Math.max(0, total - nutrients.freeSugarG);
      provenance.intrinsicSugarG = { source: provenance.freeSugarG.source, confidence: provenance.freeSugarG.confidence ?? 'high', method: 'difference', classification };
    } else if (directIntrinsic && !directFree && Number.isFinite(total)) {
      nutrients.freeSugarG = Math.max(0, total - nutrients.intrinsicSugarG);
      provenance.freeSugarG = { source: provenance.intrinsicSugarG.source, confidence: provenance.intrinsicSugarG.confidence ?? 'high', method: 'difference', classification };
    }
  } else if (Number.isFinite(total) && ALL_FREE.has(classification)) {
    set(total, 0, { ...base, confidence: 'high', method: 'food-rule', reasons: ['All sugar in this kind of food counts as free sugar'] });
  } else if (Number.isFinite(total) && ALL_INTRINSIC.has(classification)) {
    set(0, total, { ...base, confidence: 'high', method: 'food-rule', reasons: ['Sugar inside whole foods and plain milk is intrinsic'] });
  } else if (Number.isFinite(total) && Number.isFinite(added) && SPLIT.has(classification)) {
    const free = Math.min(total, added);
    set(free, Math.max(0, total - free), { source: provenance.addedSugarG?.source ?? base.source, confidence: 'high', method: 'difference', classification,
      reasons: [`Added sugar is ${added} g of ${total} g total sugar`] });
  } else if (Number.isFinite(total) && Number.isFinite(input?.comparableAddedSugarG?.min) && Number.isFinite(input?.comparableAddedSugarG?.max)) {
    const min = Math.max(0, Math.min(total, input.comparableAddedSugarG.min));
    const max = Math.max(min, Math.min(total, input.comparableAddedSugarG.max));
    const selected = (min + max) / 2;
    set(selected, total - selected, { source: 'ai', confidence: 'low', method: 'ingredient-estimate', classification,
      estimatedRange: { min, max, selected },
      reasons: [...ingredientEvidence.freeSugarIngredients.map(term => `Contains ${term}`), `Total sugar is ${total} g`] });
  } else if (Number.isFinite(total) && hasIngredients && !ingredientEvidence.freeSugarIngredients.length && SPLIT.has(classification)) {
    set(0, total, { ...base, confidence: 'medium', method: 'food-rule', reasons: ['No sweetener in the ingredient list'] });
  }

  const issues = validateSugarBreakdown(nutrients);
  if (!Number.isFinite(nutrients.freeSugarG) && ingredientEvidence.freeSugarIngredients.length) issues.push('freeSugarAmountUnknown');
  return { nutrients, provenance, ingredientEvidence, issues: [...new Set(issues)] };
}
