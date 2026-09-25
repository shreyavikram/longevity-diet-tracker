import { requestAnalysis, requestMatchChoice, AnalysisError } from './services/anthropic.js';
import { searchFoods, rankCandidates } from './services/food-data-central.js';
import { MACRO_NUTRIENTS, NUTRIENTS } from './constants.js';

const MICROS = new Set(NUTRIENTS.filter(item => item.group === 'micros').map(item => item.key));
const CANONICAL = new Set([...MACRO_NUTRIENTS, ...NUTRIENTS].map(item => item.key));
const known = value => Number.isFinite(value) && value >= 0;
const flat = values => ({ ...(values ?? {}), ...(values?.micros ?? {}) });

export function mergeNutrientSources({ manual, label, saved, usda, ai } = {}) {
  const values = {};
  const provenance = {};
  const usdaRecords = (Array.isArray(usda) ? usda : [usda]).filter(Boolean);
  const sources = [
    ['ai', ai],
    ...usdaRecords.filter(item => item.dataType !== 'Branded').map(item => ['usda', item]),
    ...usdaRecords.filter(item => item.dataType === 'Branded').map(item => ['usdaBranded', item]),
    ['saved', saved], ['label', label], ['manual', manual]
  ];
  for (const [source, input] of sources) {
    const nutrients = flat(input?.values ?? input);
    for (const [key, value] of Object.entries(nutrients)) {
      if (!CANONICAL.has(key) || !known(value)) continue;
      values[key] = value;
      provenance[key] = {
        source,
        confidence: input?.provenance?.[key]?.confidence ?? (source === 'manual' || source === 'label' ? 'high' : source === 'ai' ? 'low' : 'medium'),
        ...(input?.fdcId ? { sourceId: String(input.fdcId) } : {}),
        ...(input?.retrievedAt ? { retrievedAt: input.retrievedAt } : {}),
        ...(input?.verifiedAt ? { verifiedAt: input.verifiedAt } : {})
      };
    }
  }
  return { values, provenance };
}

function nested(values) {
  const perServing = {};
  for (const [key, value] of Object.entries(values)) {
    if (MICROS.has(key)) {
      perServing.micros ??= {};
      perServing.micros[key] = value;
    } else perServing[key] = value;
  }
  return perServing;
}

function summarizeContributors(contributors) {
  if (contributors.length === 1) return { ...contributors[0], contributors };
  const source = contributors.every(item => item.source === contributors[0].source)
    ? contributors[0].source : 'mixed';
  const confidenceRank = { low: 0, medium: 1, high: 2 };
  const confidence = contributors.reduce((lowest, item) =>
    confidenceRank[item.confidence] < confidenceRank[lowest] ? item.confidence : lowest, 'high');
  const sourceIds = contributors.map(item => item.sourceId).filter(Boolean);
  const summary = { source, confidence, contributors, ...(sourceIds.length ? { sourceIds } : {}) };
  if (source !== 'mixed') {
    for (const field of ['retrievedAt', 'verifiedAt']) {
      const date = contributors[0][field];
      if (date && contributors.every(item => item[field] === date)) summary[field] = date;
    }
  }
  return summary;
}

export function resolveDraft(draft, selections = {}) {
  const recipeTotal = {};
  const provenance = {};
  const reportedBy = {};
  const components = draft.components.map((component, index) => ({ ...component,
    selectedFdcId: selections[index] ? Number(selections[index]) : component.selectedFdcId }));
  const servings = draft.totalServings ?? 1;
  if (!Number.isFinite(servings) || servings <= 0 || (draft.kind === 'recipe' && !draft.totalServings)) {
    throw new AnalysisError('missing_basis', 'The number of recipe servings is required before nutrition can be calculated.');
  }
  const labelValues = draft.labelNutrients ?? {};
  const hasLabelValues = Object.keys(labelValues).length > 0;
  if (hasLabelValues && (!Number.isFinite(draft.labelServingGrams) || draft.labelServingGrams <= 0)) {
    throw new AnalysisError('missing_basis', 'The printed label serving weight is required before nutrition can be calculated.');
  }
  const labelComponentIndex = draft.labelComponentIndex ?? (components.length === 1 ? 0 : null);
  if (hasLabelValues && (!Number.isInteger(labelComponentIndex) || labelComponentIndex < 0 || labelComponentIndex >= components.length)) {
    throw new AnalysisError('missing_basis', 'Identify the ingredient described by the photographed label.');
  }
  const labelComponent = hasLabelValues ? components[labelComponentIndex] : null;
  const trackedServingGrams = labelComponent ? labelComponent.estimatedGrams / servings : null;
  const labelBasis = labelComponent ? { componentIndex: labelComponentIndex, componentName: labelComponent.name,
    printedServingGrams: draft.labelServingGrams, trackedServingGrams,
    scaleFactor: trackedServingGrams / draft.labelServingGrams } : null;
  for (const [index, component] of components.entries()) {
    const selected = component.candidates.find(food => String(food.fdcId) === String(component.selectedFdcId));
    const factor = selected?.basis === 'perServing' && selected.servingSize
      ? component.estimatedGrams / selected.servingSize : component.estimatedGrams / 100;
    const scaledUsda = selected ? Object.fromEntries(Object.entries(selected.values).map(([key, value]) => [key, value * factor])) : {};
    const scaledLabel = hasLabelValues && index === labelComponentIndex
      ? Object.fromEntries(Object.entries(labelValues).map(([key, value]) => [key, value * component.estimatedGrams / draft.labelServingGrams])) : {};
    const fallback = !selected && component.fallbackNutrients ? component.fallbackNutrients : undefined;
    const merged = mergeNutrientSources({ usda: selected ? { ...selected, values: scaledUsda } : undefined,
      label: Object.keys(scaledLabel).length ? scaledLabel : undefined, ai: fallback });
    for (const [key, value] of Object.entries(merged.values)) {
      recipeTotal[key] = (recipeTotal[key] ?? 0) + value;
      reportedBy[key] = (reportedBy[key] ?? 0) + 1;
      const source = merged.provenance[key];
      const contributor = { ...source, componentIndex: index, componentName: component.name, amount: value };
      if (source.source === 'label') Object.assign(contributor, { labelServingGrams: draft.labelServingGrams,
        trackedServingGrams, scaleFactor: labelBasis.scaleFactor });
      const contributors = [...(provenance[key]?.contributors ?? []), contributor];
      provenance[key] = summarizeContributors(contributors);
    }
  }
  for (const key of Object.keys(recipeTotal)) if (reportedBy[key] < components.length) {
    delete recipeTotal[key];
    delete provenance[key];
  }
  const perServing = nested(Object.fromEntries(Object.entries(recipeTotal).map(([key, value]) => [key, value / servings])));
  const basisNote = labelBasis ? `Label values for ${labelBasis.componentName} scaled from ${labelBasis.printedServingGrams} g printed serving to ${labelBasis.trackedServingGrams} g of that ingredient per tracked serving.` : null;
  const assumptions = [...(draft.assumptions ?? [])];
  if (basisNote && !assumptions.includes(basisNote)) assumptions.push(basisNote);
  return { ...draft, labelComponentIndex, components, assumptions, labelBasis, recipeTotal: nested(recipeTotal), perServing, provenance,
    pendingCandidates: components.flatMap((component, index) => component.matchResolved
      || !component.candidates.length || component.candidates.some(food => String(food.fdcId) === String(component.selectedFdcId)) ? [] : [index]) };
}

function answeredNumber(history, id, unitPattern) {
  const answer = [...(history ?? [])].reverse().find(item => item.id === id)?.answer;
  if (typeof answer !== 'string') return null;
  const matched = answer.match(new RegExp(`^\\s*(\\d+(?:\\.\\d+)?)\\s*(?:${unitPattern})?\\s*$`, 'i'));
  const number = matched ? Number(matched[1]) : NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function componentIdentity(component) {
  const normalize = value => String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  return [component.name, component.householdAmount, `${component.estimatedGrams} g`, component.usdaSearch]
    .map(normalize).join(' | ');
}

function labelComponentQuestion(components) {
  const identities = components.map(componentIdentity);
  if (new Set(identities).size !== identities.length) {
    return { status: 'needs_clarification', questions: [{ id: 'labelComponentDetail',
      prompt: 'Some ingredients look identical. Please describe which one the photographed label belongs to, including a distinguishing amount or product name.' }] };
  }
  return { status: 'needs_clarification', questions: [{ id: 'labelComponentIdentity',
    prompt: 'Which ingredient does the photographed label describe?',
    options: components.map((component, index) => ({ value: identities[index],
      label: `${component.name}, ${component.householdAmount} (${component.estimatedGrams} g)` })) }] };
}

export async function analyzeInput({ kind, text = '', image, clarificationHistory = [], settings, trackedNutrients = [], fetchFn = globalThis.fetch, signal, wait }) {
  const parsed = await requestAnalysis({ kind, text, image, clarificationHistory, settings, trackedNutrients, fetchFn, signal, wait });
  if (parsed.status === 'needs_clarification') return parsed;
  const labelKind = kind === 'labelPhoto' || (kind === 'auto' && Boolean(image));
  if (kind === 'recipe' && !parsed.totalServings) {
    const answered = answeredNumber(clarificationHistory, 'totalServings', 'servings?');
    if (!answered) return { status: 'needs_clarification', questions: [{ id: 'totalServings', prompt: 'How many servings does the full recipe make?' }] };
    parsed.totalServings = answered;
  }
  if (labelKind && Object.keys(parsed.labelNutrients ?? {}).length
    && (!Number.isFinite(parsed.labelServingGrams) || parsed.labelServingGrams <= 0)) {
    const answered = answeredNumber(clarificationHistory, 'labelServingGrams', 'g|grams?');
    if (!answered) return { status: 'needs_clarification', questions: [{ id: 'labelServingGrams', prompt: 'How many grams are in one printed label serving?' }] };
    parsed.labelServingGrams = answered;
  }
  if (labelKind && Object.keys(parsed.labelNutrients ?? {}).length) {
    const identities = parsed.components.map(componentIdentity);
    const lastIdentity = clarificationHistory.findLastIndex(item => item.id === 'labelComponentIdentity');
    const lastDetail = clarificationHistory.findLastIndex(item => item.id === 'labelComponentDetail');
    if (lastIdentity > lastDetail) {
      const matches = identities.flatMap((identity, index) => identity === clarificationHistory[lastIdentity].answer ? [index] : []);
      if (matches.length !== 1) return labelComponentQuestion(parsed.components);
      parsed.labelComponentIndex = matches[0];
    } else if (parsed.components.length === 1 && parsed.labelComponentIndex === undefined) {
      parsed.labelComponentIndex = 0;
    }
    if (!Number.isInteger(parsed.labelComponentIndex) || parsed.labelComponentIndex < 0
      || parsed.labelComponentIndex >= parsed.components.length
      || identities.filter(identity => identity === identities[parsed.labelComponentIndex]).length !== 1) {
      return labelComponentQuestion(parsed.components);
    }
  }
  const components = [];
  for (const component of parsed.components) {
    let candidates = [];
    let lookupError;
    try {
      candidates = rankCandidates(component, await searchFoods(component.usdaSearch, settings?.foodDataCentralApiKey, fetchFn, { signal }));
    } catch (error) {
      if (error.code === 'cancelled') throw error;
      if (!(error instanceof AnalysisError)) throw error;
      lookupError = error.message;
    }
    components.push({ ...component, candidates: candidates.slice(0, 8), selectedFdcId: null, matchResolved: true,
      ...(lookupError ? { lookupError } : {}) });
  }
  // The AI picks each ingredient's USDA record; if that step fails, its own estimates stand in.
  let choices = new Map();
  try {
    choices = await requestMatchChoice({ components, settings, fetchFn, signal, wait });
  } catch (error) {
    if (error.code === 'cancelled') throw error;
  }
  for (const [index, component] of components.entries()) component.selectedFdcId = choices.get(index) ?? null;
  const draft = resolveDraft({
    kind,
    name: parsed.name,
    servingLabel: parsed.servingLabel,
    components,
    confidence: parsed.confidence,
    assumptions: parsed.assumptions,
    totalServings: parsed.totalServings ?? 1,
    labelNutrients: parsed.labelNutrients ?? {},
    labelServingGrams: parsed.labelServingGrams ?? null,
    labelComponentIndex: parsed.labelComponentIndex
  });
  return { status: 'estimate', draft };
}
