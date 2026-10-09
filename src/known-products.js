// Products whose printed labels the app keeps (her request, 2026-10-08, after AI guesses for Huel and Silk
// proved wrong in about a third of her entries): every preset, plus Library foods whose calories come from a
// label. Each analysis sends their names; an ingredient the AI tags with one uses its label, not a guess.
import { PRESET_GROUPS } from './presets.js';

const DERIVED = new Set(['freeSugarG', 'intrinsicSugarG']);

export function knownProducts(library = []) {
  const presets = PRESET_GROUPS.flatMap(group => group.items);
  const names = new Set(presets.map(item => item.name.toLowerCase()));
  const labelled = (library ?? []).filter(item => item && item.type !== 'supplement' && item.perServing
    && item.provenance?.calories?.source === 'label' && !names.has(String(item.name).toLowerCase()));
  return [...presets, ...labelled].map(item => ({ id: item.id, name: item.name, servingLabel: item.servingLabel,
    perServing: item.perServing, provenance: item.provenance ?? {},
    gi: item.glycemic?.components?.length === 1 ? item.glycemic.components[0].gi ?? null : null,
    ...(Number.isFinite(item.fluidMl) && item.fluidMl > 0 ? { fluidMl: item.fluidMl } : {}) }));
}

export const productPromptList = products => products.map(product => ({ id: product.id, name: product.name, serving: product.servingLabel }));

// Label values for the servings eaten. Free and intrinsic sugar are left out: they are derived again for the
// whole entry once every ingredient is merged.
export function productValues(product, servings) {
  const values = {};
  for (const [key, value] of Object.entries({ ...product.perServing, ...(product.perServing?.micros ?? {}) })) {
    if (key === 'micros' || DERIVED.has(key) || !Number.isFinite(value)) continue;
    values[key] = value * servings;
  }
  return values;
}
