// Estimated glycemic load (GL) = GI × available carbohydrate (g) ÷ 100, per carbohydrate-containing component.
// Available carbohydrate is carbohydrate minus fiber; sugar alcohols are not subtracted. A material component
// (1 g or more of available carbohydrate) with no GI evidence is never counted as zero: the result becomes a
// lower bound. Protein and fat are not used to lower GL.
import { GI_REFERENCE } from './gi-reference.js';

// Words that name a different form of a food; a reference only matches when its own terms include them, so
// "brown rice syrup" never matches brown rice and "oat milk" never matches oatmeal.
const FORM_WORDS = new Set(['syrup', 'milk', 'flour', 'cracker', 'cake', 'chip', 'crisp', 'noodle', 'juice', 'bar', 'drink',
  'sauce', 'jam', 'bread', 'tortilla', 'pasta', 'spaghetti', 'soup', 'pie', 'fry', 'fries', 'powder', 'protein', 'cereal',
  'flake', 'candy', 'cream', 'yogurt', 'smoothie', 'mashed', 'instant', 'porridge', 'roti', 'chapatti', 'cola', 'soda']);
const PREPARATION_SYNONYMS = { cooked: ['boiled', 'steamed', 'cooked'], boiled: ['boiled', 'cooked'], steamed: ['steamed', 'cooked'] };

const singular = word => word.length > 3 && word.endsWith('oes') ? word.slice(0, -2)
  : word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
const words = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/).filter(Boolean).map(singular);

function termMatches(termWords, nameWords) {
  return termWords.every(word => nameWords.has(word));
}

export function availableCarbs(nutrients) {
  return Number.isFinite(nutrients?.carbsG) && Number.isFinite(nutrients?.fiberG)
    ? Math.max(0, nutrients.carbsG - nutrients.fiberG) : null;
}

// Finds one unambiguous reference food for a component, or null.
export function matchGiEvidence(component) {
  const nameWords = new Set(words(component?.name));
  if (!nameWords.size) return null;
  const preparationWords = new Set([...words(component?.preparation), ...nameWords]);
  let best = [];
  let bestLength = 0;
  for (const reference of GI_REFERENCE) {
    for (const term of reference.matchTerms) {
      const termWords = words(term);
      if (!termMatches(termWords, nameWords)) continue;
      // Any form word in the name that the reference term does not itself contain rules the match out.
      if ([...nameWords].some(word => FORM_WORDS.has(word) && !termWords.includes(word))) continue;
      if (termWords.length > bestLength) {
        best = [reference];
        bestLength = termWords.length;
      } else if (termWords.length === bestLength && !best.includes(reference)) best.push(reference);
    }
  }
  if (best.length !== 1) return null;
  const [reference] = best;
  const preparationMatched = reference.preparations.some(preparation =>
    (PREPARATION_SYNONYMS[preparation] ?? [preparation]).some(word => preparationWords.has(word)));
  return {
    value: reference.value,
    range: { ...reference.range },
    sourceType: 'reference-match',
    sourceName: reference.sourceName,
    sourceUrl: reference.sourceUrl,
    referenceName: reference.name,
    preparation: reference.preparations.join(', '),
    confidence: preparationMatched ? 'medium' : 'low'
  };
}

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 };
const lowest = levels => levels.reduce((low, level) => (CONFIDENCE_RANK[level] ?? 1) < (CONFIDENCE_RANK[low] ?? 1) ? level : low, 'high');

// components: [{ name, nutrients: { carbsG, fiberG } per serving, gi }]. manualGi applies to the whole item.
export function buildItemGlycemic({ components = [], perServing = {}, manualGi = null } = {}) {
  const itemCarbs = availableCarbs(perServing);
  if (manualGi && Number.isFinite(manualGi.value)) {
    if (!Number.isFinite(itemCarbs)) {
      return { components: [], availableCarbsG: null, gl: null, range: null, completeness: 'unknown', confidence: 'low', missingFrom: ['this food'], manualGi };
    }
    const gl = manualGi.value * itemCarbs / 100;
    return { components: [], availableCarbsG: itemCarbs, gl, range: { min: gl, max: gl }, completeness: 'complete',
      confidence: manualGi.confidence ?? 'medium', missingFrom: [], manualGi };
  }
  const results = components.map(component => {
    const carbs = availableCarbs(component.nutrients);
    const gi = component.gi ?? null;
    if (Number.isFinite(carbs) && carbs < 1) return { name: component.name, availableCarbsG: carbs, gi, gl: 0, min: 0, max: 0, material: false };
    if (!Number.isFinite(carbs) || !gi || !Number.isFinite(gi.value)) return { name: component.name, availableCarbsG: carbs, gi, gl: null, material: true };
    return { name: component.name, availableCarbsG: carbs, gi, gl: gi.value * carbs / 100,
      min: (gi.range?.min ?? gi.value) * carbs / 100, max: (gi.range?.max ?? gi.value) * carbs / 100, material: true };
  });
  const known = results.filter(result => Number.isFinite(result.gl));
  const missing = results.filter(result => !Number.isFinite(result.gl));
  const knownMaterial = known.filter(result => result.material);
  const sum = key => known.reduce((total, result) => total + result[key], 0);
  const completeness = !results.length ? 'unknown'
    : !missing.length ? 'complete'
      : knownMaterial.length ? 'partial' : 'unknown';
  return {
    components: results,
    availableCarbsG: itemCarbs,
    gl: completeness === 'unknown' ? null : sum('gl'),
    range: completeness === 'unknown' ? null : { min: sum('min'), max: sum('max') },
    completeness,
    confidence: knownMaterial.length ? lowest(knownMaterial.map(result => result.gi.confidence ?? 'low')) : 'low',
    missingFrom: missing.map(result => result.name)
  };
}

// Scales an item's per-serving GL evidence to the servings logged.
export function scaleGlycemic(glycemic, servings) {
  if (!glycemic) return null;
  const scale = value => Number.isFinite(value) ? value * servings : value;
  return {
    ...structuredClone(glycemic),
    availableCarbsG: scale(glycemic.availableCarbsG),
    gl: scale(glycemic.gl),
    range: glycemic.range ? { min: scale(glycemic.range.min), max: scale(glycemic.range.max) } : null,
    components: (glycemic.components ?? []).map(component => ({ ...component, availableCarbsG: scale(component.availableCarbsG),
      gl: scale(component.gl), min: scale(component.min), max: scale(component.max) }))
  };
}
