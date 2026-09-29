import { requestAnalysis, requestMatchChoice, AnalysisError } from './services/anthropic.js';
import { searchFoods, rankCandidates } from './services/food-data-central.js';
import { CANONICAL_NUTRIENT_KEYS, MACRO_NUTRIENTS, NUTRIENTS } from './constants.js';
import { extractIngredients, parseNutritionLabel, statedNutrientsFromText } from './nutrition-label.js';
import { deriveSugarBreakdown } from './sugar.js';
import { buildItemGlycemic, matchGiEvidence } from './glycemic.js';

const MICROS = new Set(NUTRIENTS.filter(item => item.group === 'micros').map(item => item.key));
const CANONICAL = CANONICAL_NUTRIENT_KEYS;
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

// Splits total sugar into free and intrinsic sugar once every source has been merged, so the food rules work
// from the tracked serving's own values. Added sugar stays as its own fact.
function withSugar(flatPerServing, provenance, { classification = 'other', ingredientsText = '', comparableAddedSugarG } = {}) {
  const sugar = deriveSugarBreakdown({ nutrients: flatPerServing, provenance, classification, ingredientsText, comparableAddedSugarG });
  return { perServing: nested(sugar.nutrients), provenance: sugar.provenance, ingredientEvidence: sugar.ingredientEvidence, sugarIssues: sugar.issues };
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
  const componentCarbs = [];
  for (const [index, component] of components.entries()) {
    const selected = component.candidates.find(food => String(food.fdcId) === String(component.selectedFdcId));
    const factor = selected?.basis === 'perServing' && selected.servingSize
      ? component.estimatedGrams / selected.servingSize : component.estimatedGrams / 100;
    const scaledUsda = selected ? Object.fromEntries(Object.entries(selected.values).map(([key, value]) => [key, value * factor])) : {};
    const scaledLabel = hasLabelValues && index === labelComponentIndex
      ? Object.fromEntries(Object.entries(labelValues).map(([key, value]) => [key, value * component.estimatedGrams / draft.labelServingGrams])) : {};
    const labelled = hasLabelValues && index === labelComponentIndex;
    // The AI's estimate fills whatever the USDA record leaves unknown (USDA wins where it reports). A labelled
    // product keeps exactly what its label says.
    const fallback = !labelled && component.fallbackNutrients ? component.fallbackNutrients : undefined;
    const merged = mergeNutrientSources({ usda: selected ? { ...selected, values: scaledUsda } : undefined,
      label: Object.keys(scaledLabel).length ? scaledLabel : undefined, ai: fallback });
    componentCarbs.push(Object.fromEntries(['carbsG', 'fiberG'].filter(key => Number.isFinite(merged.values[key]))
      .map(key => [key, merged.values[key] / servings])));
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
  // A nutrient some ingredients do not report keeps its known part, flagged partial with the missing
  // ingredients named, so coverage can show progress. Calories stay strict: an undercount would
  // misstate the remaining budget.
  for (const key of Object.keys(recipeTotal)) if (reportedBy[key] < components.length) {
    if (key === 'calories') {
      delete recipeTotal[key];
      delete provenance[key];
      continue;
    }
    const reported = new Set((provenance[key].contributors ?? []).map(contributor => contributor.componentIndex));
    provenance[key] = { ...provenance[key], partial: true,
      missingFrom: components.filter((component, index) => !reported.has(index)).map(component => component.name) };
  }
  const classification = draft.classification ?? 'other';
  const ingredientsText = draft.ingredientsText ?? '';
  const sugar = withSugar(Object.fromEntries(Object.entries(recipeTotal).map(([key, value]) => [key, value / servings])), provenance,
    { classification, ingredientsText, comparableAddedSugarG: draft.comparableAddedSugarG });
  const perServing = sugar.perServing;
  for (const key of ['freeSugarG', 'intrinsicSugarG']) if (Number.isFinite(sugar.perServing[key])) recipeTotal[key] = sugar.perServing[key] * servings;
  const basisNote = labelBasis ? `Label values for ${labelBasis.componentName} scaled from ${labelBasis.printedServingGrams} g printed serving to ${labelBasis.trackedServingGrams} g of that ingredient per tracked serving.` : null;
  const assumptions = [...(draft.assumptions ?? [])];
  if (basisNote && !assumptions.includes(basisNote)) assumptions.push(basisNote);
  const glycemic = buildItemGlycemic({ perServing: { ...perServing, ...(perServing.micros ?? {}) },
    components: components.map((component, index) => ({ name: component.name, nutrients: componentCarbs[index],
      gi: matchGiEvidence(component) ?? matchGiEvidence({ name: component.usdaSearch, preparation: component.preparation }) })) });
  return { ...draft, classification, ingredientsText, glycemic, labelComponentIndex, components, assumptions, labelBasis, recipeTotal: nested(recipeTotal), perServing,
    provenance: sugar.provenance, ingredientEvidence: sugar.ingredientEvidence, sugarIssues: sugar.sugarIssues,
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

// Plain water adds nothing tracked, but its USDA record omits most nutrients, and a nutrient is known for a
// mixture only when every ingredient reports it. Listing water would erase the rest of the shake's nutrients.
const PLAIN_WATER = /^(?:plain|tap|filtered|still|sparkling|bottled|cold|hot|warm|mineral)?\s*(?:water|ice)(?:\s*,?\s*(?:tap|plain|filtered|bottled))?$/i;

function dropPlainWater(parsed) {
  const isWater = component => PLAIN_WATER.test(component.name.trim()) || PLAIN_WATER.test(component.usdaSearch.trim());
  const kept = parsed.components.filter(component => !isWater(component));
  if (!kept.length || kept.length === parsed.components.length) return;
  if (Number.isInteger(parsed.labelComponentIndex)) {
    const labelled = parsed.components[parsed.labelComponentIndex];
    parsed.labelComponentIndex = labelled && kept.includes(labelled) ? kept.indexOf(labelled) : undefined;
  }
  parsed.components = kept;
  parsed.assumptions = [...parsed.assumptions, 'Plain water is not counted; it adds no calories or tracked nutrients.'];
}

// Nutrition numbers the person typed override every other source for that nutrient, per serving.
function applyStatedNutrients(draft, stated) {
  if (!stated || !Object.keys(stated).length) return draft;
  const perServing = structuredClone(draft.perServing);
  const provenance = { ...draft.provenance };
  for (const [key, value] of Object.entries(stated)) {
    if (MICROS.has(key)) {
      perServing.micros ??= {};
      perServing.micros[key] = value;
    } else perServing[key] = value;
    provenance[key] = { source: 'manual', confidence: 'high' };
  }
  const note = 'Nutrition numbers you entered were used as written.';
  // Typed sugar numbers change the free and intrinsic split, so derived values are recalculated from them.
  for (const key of ['freeSugarG', 'intrinsicSugarG']) if (!Object.hasOwn(stated, key) && provenance[key]?.method) {
    delete perServing[key];
    delete provenance[key];
  }
  const { micros = {}, ...topLevel } = perServing;
  const sugar = withSugar({ ...topLevel, ...micros }, provenance,
    { classification: draft.classification ?? 'other', ingredientsText: draft.ingredientsText ?? '' });
  return { ...draft, perServing: sugar.perServing, provenance: sugar.provenance, ingredientEvidence: sugar.ingredientEvidence, sugarIssues: sugar.sugarIssues,
    statedNutrients: { ...stated },
    assumptions: draft.assumptions.includes(note) ? draft.assumptions : [...draft.assumptions, note] };
}

// A label read from text (typed, pasted, or recognized on the device) becomes a draft directly: no AI,
// no USDA, no network.
function labelTextDraft(label, text, labelText = text) {
  const before = String(text ?? '').split(/nutrition\s+facts|supplement\s+facts/i)[0].split('\n').map(line => line.trim()).filter(Boolean)[0];
  const name = before && !/calories|serving/i.test(before) ? before.slice(0, 80) : label.kind === 'supplement' ? 'Supplement (from label)' : 'Packaged food (from label)';
  const servingLabel = label.servingLabel ?? '1 serving';
  const classification = label.kind === 'supplement' ? 'other' : 'composite';
  const ingredientsText = extractIngredients(labelText) ?? '';
  const sugar = withSugar(label.nutrients, Object.fromEntries(Object.keys(label.nutrients).map(key => [key, { source: 'label', confidence: 'high' }])),
    { classification, ingredientsText });
  const { perServing, provenance, ingredientEvidence, sugarIssues } = sugar;
  const carbs = Object.fromEntries(['carbsG', 'fiberG'].filter(key => Number.isFinite(label.nutrients[key])).map(key => [key, label.nutrients[key]]));
  const glycemic = buildItemGlycemic({ perServing: label.nutrients, components: [{ name, nutrients: carbs, gi: matchGiEvidence({ name }) }] });
  return { classification, ingredientsText, ingredientEvidence, sugarIssues, glycemic, kind: 'labelPhoto', method: 'label-text', fromLabel: true, labelKind: label.kind, name, servingLabel, confidence: 'high',
    totalServings: 1, assumptions: ['Read from the nutrition label on this device; no AI or online lookup was used.'],
    components: [{ name, householdAmount: servingLabel, estimatedGrams: label.servingGrams ?? 0, usdaSearch: name, confidence: 'high',
      candidates: [], selectedFdcId: null, matchResolved: true }],
    labelBasis: null, recipeTotal: perServing, perServing, provenance, pendingCandidates: [] };
}

export async function analyzeInput({ kind, text = '', image, images = image ? [image] : [], clarificationHistory = [], settings, trackedNutrients = [], fetchFn = globalThis.fetch, signal, wait, searchCache, localSearch, recognizeText, onStage = () => {} }) {
  const typedLabel = parseNutritionLabel(text);
  if (typedLabel) return { status: 'estimate', draft: labelTextDraft(typedLabel, text) };
  // Numbers she typed (in the entry or an answer) override the label, USDA, and the AI for those nutrients.
  const typed = statedNutrientsFromText([text, ...clarificationHistory.map(item => item.answer)].join('\n'));
  // How the on-device reader did, kept with the entry so slow or failed reads on the phone can be checked later.
  let labelReader = null;
  if (images.length && recognizeText && !clarificationHistory.length) {
    onStage('reading-label');
    const started = Date.now();
    const texts = [];
    let failure = null;
    for (const photo of images) {
      try { texts.push(await recognizeText(photo, { signal })); } catch (error) { failure = String(error?.message ?? error).slice(0, 200); }
      if (signal?.aborted) throw new AnalysisError('cancelled', 'Analysis cancelled.');
    }
    // A label may be in any one photo (the front of the pack in another), or split across two: the reading
    // that finds the most nutrients is used.
    const readings = [...texts.map(parseNutritionLabel), texts.length > 1 ? parseNutritionLabel(texts.join('\n')) : null].filter(Boolean);
    const photoLabel = readings.reduce((best, reading) => !best || Object.keys(reading.nutrients).length > Object.keys(best.nutrients).length ? reading : best, null);
    labelReader = { ms: Date.now() - started, found: Boolean(photoLabel), characters: texts.join('').length,
      ...(images.length > 1 ? { photos: images.length } : {}), ...(failure ? { error: failure } : {}) };
    if (photoLabel) return { status: 'estimate', draft: applyStatedNutrients({ ...labelTextDraft(photoLabel, text, texts.join('\n')), labelReader }, typed) };
  }
  onStage('asking-ai');
  const parsed = await requestAnalysis({ kind, text, images, clarificationHistory, settings, trackedNutrients, fetchFn, signal, wait });
  if (parsed.status === 'needs_clarification') return parsed;
  dropPlainWater(parsed);
  // Label questions apply to any trusted nutrition facts: a label photo, or a product page Google read.
  const labelKind = kind === 'labelPhoto' || (kind === 'auto' && Object.keys(parsed.labelNutrients ?? {}).length > 0);
  if (kind === 'recipe' && !parsed.totalServings) {
    const answered = answeredNumber(clarificationHistory, 'totalServings', 'servings?');
    if (!answered) return { status: 'needs_clarification', questions: [{ id: 'totalServings', prompt: 'How many servings does the full recipe make?' }] };
    parsed.totalServings = answered;
  }
  // A single labelled product with no printed gram weight uses the label's own serving as-is.
  if (labelKind && Object.keys(parsed.labelNutrients ?? {}).length && parsed.components.length === 1
    && (!Number.isFinite(parsed.labelServingGrams) || parsed.labelServingGrams <= 0)) {
    parsed.labelServingGrams = parsed.components[0].estimatedGrams;
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
  for (const [index, component] of parsed.components.entries()) {
    // With a photographed or linked label, only the label is read: no USDA or online lookups for any
    // ingredient (others use the AI's own macro estimate).
    if (Object.keys(parsed.labelNutrients ?? {}).length) {
      components.push({ ...component, candidates: [], selectedFdcId: null, matchResolved: true });
      continue;
    }
    let candidates = [];
    let lookupError;
    // The on-device USDA copy answers generic foods: every search word first, then most of them (the AI
    // picks the right record or none). Live USDA is asked only with the person's own key and only when the
    // copy has nothing close; the shared demo key's hourly limit makes it unreliable otherwise.
    let local = localSearch ? await localSearch(component.usdaSearch) : null;
    if (localSearch && !local?.length) local = await localSearch(component.usdaSearch, { minShare: 0.5 });
    const liveAllowed = !localSearch || Boolean(String(settings?.foodDataCentralApiKey ?? '').trim());
    try {
      if (local?.length) {
        candidates = rankCandidates(component, local);
      } else if (liveAllowed) {
        // Remembered answers keep repeat foods from spending the shared USDA key's small hourly allowance.
        let foods = searchCache?.get?.(component.usdaSearch);
        if (!foods) {
          foods = await searchFoods(component.usdaSearch, settings?.foodDataCentralApiKey, fetchFn, { signal });
          searchCache?.set?.(component.usdaSearch, foods);
        }
        candidates = rankCandidates(component, foods);
      }
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
  const resolved = resolveDraft({
    kind,
    name: parsed.name,
    servingLabel: parsed.servingLabel,
    components,
    confidence: parsed.confidence,
    assumptions: parsed.assumptions,
    totalServings: parsed.totalServings ?? 1,
    labelNutrients: parsed.labelNutrients ?? {},
    labelServingGrams: parsed.labelServingGrams ?? null,
    labelComponentIndex: parsed.labelComponentIndex,
    classification: parsed.classification ?? 'other',
    ingredientsText: parsed.ingredientsText ?? ''
  });
  const draft = applyStatedNutrients(resolved, { ...parsed.statedNutrients, ...typed });
  return { status: 'estimate', draft: labelReader ? { ...draft, labelReader } : draft };
}
