import {
  CONFIDENCE_LEVELS,
  DEFAULT_STATE,
  LIBRARY_ITEM_TYPES,
  MACRO_NUTRIENTS,
  NUTRIENTS,
  NUTRIENT_SOURCES
} from './constants.js';
import {
  computeTargets,
  flOzToMl,
  inToCm,
  lbToKg,
  normalizeNutrients,
  nutrientValue,
  resolveEffectiveTargets,
  scaleNutrients
} from './calculations.js';
import { createStore, StorageWriteError } from './storage.js';
import { renderApp, renderInstallStatus, renderTargetCards, renderUpdateBanner } from './views.js';
import { analyzeInput, resolveDraft } from './analysis.js';
import { rankCandidates, searchFoods } from './services/food-data-central.js';
import { buildAdjustmentRecommendation } from './trends.js';
import { setupPwa } from './pwa.js';
import { mergeActivity, parseActivity } from './activity.js';

const VALID_ROUTES = new Set(['today', 'add', 'library', 'progress', 'settings']);
const HUEL_SEEDS = Object.freeze([
  {
    id: 'seed-huel-black-edition',
    type: 'packaged',
    name: 'Huel Black Edition-style smoothie',
    servingLabel: 'Enter current package serving',
    perServing: {},
    provenance: {},
    favorite: false,
    verified: false,
    seedTag: 'huel-unverified'
  },
  {
    id: 'seed-huel-hot-savory',
    type: 'packaged',
    name: 'Huel Hot & Savory meal',
    servingLabel: 'Enter current package serving',
    perServing: {},
    provenance: {},
    favorite: false,
    verified: false,
    seedTag: 'huel-unverified'
  }
]);

const clone = value => structuredClone(value);
const FOCUS_DATA_KEYS = ['action', 'route', 'itemId', 'entryId', 'nutrientId', 'nutrientOrigin', 'date', 'ml', 'days', 'id'];
const SAVED_MESSAGES = Object.freeze({
  'save-profile': 'Profile saved. Targets were recalculated.',
  'save-target-overrides': 'Target overrides saved.',
  'set-units': 'Units saved.',
  'save-tracked-nutrients': 'Nutrient list saved.',
  'save-training-behavior': 'Training behavior saved.',
  'save-water-increments': 'Water buttons saved.',
  'save-integrations': 'Integrations saved.',
  'save-body-metric': 'Reading saved.'
});

function userMessage(error) {
  const message = String(error?.message ?? '');
  if (error instanceof StorageWriteError) return message;
  if (['RangeError', 'TypeError', 'Error', 'StorageValidationError'].includes(error?.name) && message
    && !/cannot read|is not a function|is not defined|undefined|null|unexpected token/i.test(message)) return message;
  return 'That action could not be completed. Try again.';
}
const pad = value => String(value).padStart(2, '0');

export function localDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftLocalDate(date, amount) {
  assertDate(date);
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + amount);
  return parsed.toISOString().slice(0, 10);
}

function assertDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new TypeError('A local YYYY-MM-DD date is required');
  }
}

function finiteNonNegative(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new RangeError(`${name} must be a non-negative number`);
  return number;
}

function clampImperialRoundTrip(value, minimum, maximum) {
  if (Math.abs(value - minimum) <= 0.000001) return minimum;
  if (Math.abs(value - maximum) <= 0.000001) return maximum;
  return value;
}

function formNumber(formData, name) {
  const value = Number(formData.get(name));
  if (!Number.isFinite(value)) throw new TypeError(`${name} must be a number`);
  return value;
}

function profileFromForm(formData, existing, displayUnits = formData.get('units')) {
  const units = displayUnits === 'metric' ? 'metric' : 'imperial';
  const enteredHeight = formNumber(formData, 'height');
  const enteredWeight = formNumber(formData, 'weight');
  return {
    ...existing,
    sexForBmr: formData.get('sexForBmr') === 'male' ? 'male' : 'female',
    age: formNumber(formData, 'age'),
    heightCm: units === 'metric' ? enteredHeight : inToCm(enteredHeight),
    weightKg: units === 'metric' ? enteredWeight : lbToKg(enteredWeight),
    activityMultiplier: formNumber(formData, 'activityMultiplier'),
    averageSteps: formNumber(formData, 'averageSteps'),
    liftDaysPerWeek: formNumber(formData, 'liftDaysPerWeek'),
    goal: formData.get('goal') === 'fatLoss' ? 'fatLoss' : existing.goal,
    pace: ['gentle', 'moderate', 'faster'].includes(formData.get('pace')) ? formData.get('pace') : existing.pace
  };
}

export function createApp({ store, fetchFn = globalThis.fetch, clock = () => new Date(), documentRef = globalThis.document,
  cryptoRef = globalThis.crypto, confirmFn = message => globalThis.confirm?.(message) ?? false,
  pwaFactory = setupPwa, activityFetch = globalThis.fetch, activityUrl = './activity.json', downloadFn = (name, contents) => {
    const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
    const link = documentRef.createElement('a');
    link.href = url;
    link.download = name;
    documentRef.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } }) {
  if (!store) throw new TypeError('A store is required');
  const state = { route: 'today', selectedDate: localDate(clock()), progressDate: localDate(clock()),
    editingBodyMetricDate: null, dialog: null, draft: null, libraryQuery: '', analysis: null,
    dataStatus: '', notice: null, coverageOpen: false, usda: null, installStatus: '', canInstall: false, updateReady: false };
  const waterUndo = new Map();
  let listenersBound = false;
  let idSequence = 0;
  let pendingNutrientFocus = null;
  let analysisController = null;
  let analysisGeneration = 0;
  let pwa = null;

  function cancelAnalysis() {
    analysisGeneration += 1;
    analysisController?.abort();
    analysisController = null;
    state.analysis = null;
    render();
  }

  function openAnalysisReview(result) {
    const item = {
      id: null,
      type: result.kind === 'recipe' ? 'recipe' : result.kind === 'labelPhoto' ? 'packaged' : 'meal',
      name: result.name,
      servingLabel: result.servingLabel,
      perServing: result.perServing,
      provenance: result.provenance,
      confidence: result.confidence,
      assumptions: result.assumptions,
      components: result.components.map(component => ({ name: `${component.name}: ${component.householdAmount} (${component.estimatedGrams} g)` })),
      favorite: false,
      verified: false
    };
    state.draft = { kind: 'confirmation', mode: 'analysis', servings: 1, item, analysisReview: {
      totalServings: result.totalServings,
      recipeTotal: result.recipeTotal,
      labelBasis: result.labelBasis,
      components: result.components.map(component => ({ name: component.name, grams: component.estimatedGrams,
        source: component.candidates.find(food => food.fdcId === component.selectedFdcId)?.description ?? 'No USDA match' }))
    } };
    state.analysis = null;
    render();
  }

  async function startAnalysis({ kind, text, image, clarificationHistory = [] } = {}) {
    analysisController?.abort();
    const generation = ++analysisGeneration;
    analysisController = new AbortController();
    const input = { kind, text: String(text ?? ''), clarificationHistory };
    state.analysis = { status: 'loading', ...input };
    render();
    try {
      const result = await analyzeInput({ ...input, image, settings: store.get('settings'),
        trackedNutrients: store.get('settings').trackedNutrients, fetchFn, signal: analysisController.signal });
      if (generation !== analysisGeneration) return;
      if (result.status === 'needs_clarification') {
        state.analysis = { status: 'needs_clarification', ...input, questions: result.questions };
      } else if (result.draft.pendingCandidates.length || result.draft.components.some(component => !component.candidates.length)) {
        state.analysis = { status: 'candidates', ...input, draft: result.draft };
      } else openAnalysisReview(result.draft);
      render();
    } catch (error) {
      if (generation !== analysisGeneration) return;
      state.analysis = { status: 'error', ...input,
        error: error?.name === 'AnalysisError' ? error.message : 'Analysis is unavailable. Try again or enter nutrition manually.' };
      render();
    } finally {
      if (generation === analysisGeneration) analysisController = null;
      image = undefined;
    }
  }

  async function retryFoodSearch() {
    if (state.analysis?.status !== 'candidates') return;
    const previous = state.analysis;
    const generation = ++analysisGeneration;
    const controller = new AbortController();
    analysisController = controller;
    state.analysis = { status: 'loading', kind: previous.kind, text: previous.text,
      clarificationHistory: previous.clarificationHistory };
    render();
    try {
      const components = [];
      for (const component of previous.draft.components) {
        if (component.candidates.length) { components.push(component); continue; }
        try {
          const candidates = rankCandidates(component, await searchFoods(component.usdaSearch,
            store.get('settings').foodDataCentralApiKey, fetchFn, { signal: controller.signal })).slice(0, 5);
          components.push({ ...component, candidates, selectedFdcId: candidates.length === 1 ? candidates[0].fdcId : null, lookupError: undefined });
        } catch (error) {
          if (controller.signal.aborted) return;
          components.push({ ...component, lookupError: error?.name === 'AnalysisError' ? error.message : 'USDA food search is unavailable.' });
        }
      }
      if (generation !== analysisGeneration) return;
      const draft = resolveDraft({ ...previous.draft, components });
      if (draft.pendingCandidates.length || components.some(component => !component.candidates.length)) {
        state.analysis = { ...previous, draft };
        render();
      } else openAnalysisReview(draft);
    } finally {
      if (generation === analysisGeneration) analysisController = null;
    }
  }

  function getRoot() {
    return documentRef?.querySelector?.('#app') ?? null;
  }

  function focusSelector(element) {
    const root = getRoot();
    if (!element || element === root || typeof root?.contains !== 'function' || !root.contains(element)) return null;
    const escape = value => globalThis.CSS?.escape?.(String(value)) ?? String(value).replace(/["\\]/g, '\\$&');
    if (element.dataset?.action && !element.name) {
      return FOCUS_DATA_KEYS.filter(key => element.dataset[key] !== undefined)
        .map(key => `[data-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}="${escape(element.dataset[key])}"]`).join('');
    }
    if (element.name && element.form?.dataset?.action) {
      const valued = ['radio', 'checkbox', 'submit'].includes(element.type) ? `[value="${escape(element.value)}"]` : '';
      return `form[data-action="${escape(element.form.dataset.action)}"] [name="${escape(element.name)}"]${valued}`;
    }
    if (element.type === 'submit' && element.form?.dataset?.action) {
      return `form[data-action="${escape(element.form.dataset.action)}"] [type="submit"]`;
    }
    return element.id ? `#${escape(element.id)}` : '';
  }

  function focusHeading() {
    const heading = documentRef?.querySelector?.('#main-content h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }

  function restoreFocus(selector) {
    if (selector === null) return;
    const target = selector ? documentRef.querySelector(selector) : null;
    if (target && !target.disabled) target.focus({ preventScroll: true });
    else focusHeading();
  }

  function pwaUi() {
    return { installStatus: state.installStatus, canInstall: state.canInstall, updateReady: state.updateReady };
  }

  // Service-worker events arrive in the background, so they patch their own regions
  // instead of redrawing the page and discarding anything being typed.
  function refreshPwaRegions() {
    const regions = [['[data-region="update-banner"]', renderUpdateBanner], ['[data-region="install-status"]', renderInstallStatus]];
    for (const [selector, renderRegion] of regions) {
      const region = documentRef?.querySelector?.(selector);
      if (region) region.innerHTML = renderRegion(pwaUi());
    }
  }

  function patchOnboardingTargets() {
    const region = documentRef?.querySelector?.('[data-region="onboarding-targets"]');
    if (!region) return false;
    const targets = computeTargets(state.draft.profile);
    region.innerHTML = renderTargetCards(targets);
    const calorieOverride = documentRef.querySelector('form[data-action="complete-onboarding"] [name="averageCalories"]');
    if (calorieOverride) calorieOverride.min = String(targets?.bmr ?? 0);
    return true;
  }

  function render() {
    const root = getRoot();
    if (!root) return;
    const focused = focusSelector(documentRef?.activeElement);
    const data = store.loadAll();
    const computedTargets = data.meta.onboardingComplete
      ? data.targets.computed ?? computeTargets(data.profile)
      : computeTargets(state.draft?.profile ?? data.profile);
    root.innerHTML = renderApp({
      state,
      data,
      computedTargets,
      effectiveTargets: resolveEffectiveTargets(data.targets),
      ui: { canUndoWater: (waterUndo.get(state.selectedDate)?.length ?? 0) > 0,
        dataStatus: state.dataStatus, notice: state.notice, ...pwaUi() }
    });
    restoreFocus(focused);
    const nutrientDialog = documentRef?.querySelector?.('.nutrient-dialog');
    if (nutrientDialog) {
      nutrientDialog.addEventListener?.('cancel', event => {
        event.preventDefault?.();
        dispatch({ type: 'CLOSE_NUTRIENT_DETAILS' });
      }, { once: true });
      if (typeof nutrientDialog.showModal === 'function' && !nutrientDialog.open) {
        nutrientDialog.showModal();
      }
      nutrientDialog.focus?.();
    }
    if (pendingNutrientFocus) {
      const { nutrientId, nutrientOrigin } = pendingNutrientFocus;
      pendingNutrientFocus = null;
      documentRef?.querySelector?.(`[data-action="open-nutrient-details"][data-nutrient-id="${nutrientId}"][data-nutrient-origin="${nutrientOrigin}"]`)?.focus?.();
    }
  }

  function resetScroll() {
    documentRef?.defaultView?.scrollTo?.({ top: 0, left: 0, behavior: 'auto' });
  }

  function updateDatedMap(key, date, updater) {
    assertDate(date);
    store.update(key, map => ({ ...map, [date]: updater(clone(map[date])) }));
  }

  function nextId(prefix) {
    const uuid = cryptoRef?.randomUUID?.();
    if (uuid) return `${prefix}-${uuid}`;
    idSequence += 1;
    return `${prefix}-${clock().getTime()}-${idSequence}`;
  }

  function localTimestamp(date = clock()) {
    return `${localDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function knownNutrientKeys(nutrients) {
    const keys = new Set();
    for (const [key, value] of Object.entries(nutrients ?? {})) {
      if (Number.isFinite(value)) keys.add(key);
      else if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const nestedKey of knownNutrientKeys(value)) keys.add(nestedKey);
      }
    }
    return keys;
  }

  function canonicalItem(item) {
    const next = clone(item);
    next.perServing = normalizeNutrients(next.perServing ?? {});
    const known = knownNutrientKeys(next.perServing);
    next.provenance = Object.fromEntries(Object.entries(next.provenance ?? {})
      .filter(([key]) => known.has(key))
      .map(([key, provenance]) => [key, clone(provenance)]));
    return next;
  }

  function seedHuelLibrary() {
    store.update('library', library => {
      const ids = new Set(library.map(item => item.id));
      return [...library, ...HUEL_SEEDS.filter(item => !ids.has(item.id)).map(clone)];
    });
  }

  function completeOnboarding(action) {
    const profile = clone(action.profile);
    const computed = computeTargets(profile);
    store.set('profile', profile);
    store.set('targets', { autoCompute: true, computed, overrides: clone(action.overrides ?? {}) });
    store.update('settings', settings => ({
      ...settings,
      units: action.units ?? settings.units,
      usesSupplements: action.usesSupplements ?? settings.usesSupplements ?? false
    }));
    seedHuelLibrary();
    store.update('meta', meta => ({
      ...meta,
      onboardingComplete: true,
      disclaimerAcknowledgedAt: action.disclaimerAcknowledgedAt ?? clock().toISOString()
    }));
    state.route = 'today';
    state.draft = null;
  }

  function valuesFromForm(form) {
    const FormDataConstructor = documentRef?.defaultView?.FormData ?? globalThis.FormData;
    return new FormDataConstructor(form);
  }

  function targetOverridesFromForm(formData) {
    const overrides = {};
    for (const field of ['averageCalories', 'proteinG']) {
      const raw = formData.get(field);
      if (raw !== null && raw !== '') overrides[field] = finiteNonNegative(raw, field);
    }
    return overrides;
  }

  function draftFromForm(formData, changedName = '') {
    const settings = store.get('settings');
    const currentUnits = state.draft?.units ?? settings.units;
    const selectedUnits = formData.get('units') === 'metric' ? 'metric' : 'imperial';
    const parseUnits = changedName === 'units' ? currentUnits : selectedUnits;
    return {
      profile: profileFromForm(formData, state.draft?.profile ?? store.get('profile'), parseUnits),
      units: selectedUnits,
      usesSupplements: formData.has('usesSupplements'),
      acknowledgeDisclaimer: formData.has('acknowledgeDisclaimer'),
      overrides: targetOverridesFromForm(formData)
    };
  }

  function saveLibraryItem(item) {
    if (!item?.id) throw new TypeError('Library items require an id');
    if (!LIBRARY_ITEM_TYPES.some(type => type.id === item.type)) throw new TypeError('Library item type is invalid');
    const canonical = canonicalItem(item);
    const now = clock().toISOString();
    store.update('library', library => {
      const index = library.findIndex(candidate => candidate.id === canonical.id);
      if (index < 0) return [...library, { ...canonical, createdAt: canonical.createdAt ?? now, updatedAt: now }];
      const existing = library[index];
      const replacement = {
        ...canonical,
        createdAt: canonical.createdAt ?? existing.createdAt ?? now,
        updatedAt: now,
        ...(existing.lastUsedAt ? { lastUsedAt: existing.lastUsedAt } : {}),
        ...(canonical.seedTag || existing.seedTag ? { seedTag: canonical.seedTag ?? existing.seedTag } : {})
      };
      return library.map((candidate, candidateIndex) => candidateIndex === index ? replacement : candidate);
    });
  }

  function snapshotFromItem(item, servings, previous = {}) {
    const canonical = canonicalItem(item);
    const perServing = canonical.perServing;
    return {
      ...previous,
      itemId: canonical.id ?? previous.itemId ?? null,
      type: canonical.type,
      name: canonical.name,
      servingLabel: canonical.servingLabel,
      servings,
      perServing,
      nutrients: scaleNutrients(perServing, servings),
      provenance: canonical.provenance,
      confidence: canonical.confidence ?? null,
      assumptions: clone(canonical.assumptions ?? []),
      components: clone(canonical.components ?? [])
    };
  }

  function logItem(action) {
    assertDate(action.date);
    const servings = finiteNonNegative(action.servings, 'Servings');
    if (servings === 0) throw new RangeError('Servings must be greater than zero');
    const library = store.get('library');
    const item = action.item ? clone(action.item) : library.find(candidate => candidate.id === action.itemId);
    if (!item) throw new Error(`Library item not found: ${action.itemId}`);
    if (item.type === 'supplement') {
      throw new TypeError('Use supplement completion instead of the food log');
    }
    const entry = {
      ...snapshotFromItem(item, servings),
      id: nextId('log'),
      loggedAt: clock().toISOString(),
      loggedAtLocal: localTimestamp()
    };
    updateDatedMap('log', action.date, entries => [...(entries ?? []), entry]);
    if (item.id && library.some(candidate => candidate.id === item.id)) {
      store.update('library', items => items.map(candidate => candidate.id === item.id
        ? { ...candidate, lastUsedAt: entry.loggedAt }
        : candidate));
    }
  }

  function editLogEntry(action) {
    const servings = finiteNonNegative(action.servings, 'Servings');
    if (servings === 0) throw new RangeError('Servings must be greater than zero');
    updateDatedMap('log', action.date, entries => (entries ?? []).map(entry => {
      if (entry.id !== action.entryId) return entry;
      if (action.item && action.item.type !== entry.type) return entry;
      const replacement = action.item ? snapshotFromItem(action.item, servings, entry) : {
        ...entry,
        servings,
        nutrients: scaleNutrients(entry.perServing, servings)
      };
      return { ...replacement, id: entry.id, loggedAt: entry.loggedAt, editedAt: clock().toISOString() };
    }));
  }

  function toggleSupplement(action) {
    const item = store.get('library').find(candidate => candidate.id === action.itemId);
    if (!item || item.type !== 'supplement') throw new Error(`Supplement not found: ${action.itemId}`);
    updateDatedMap('dayState', action.date, day => {
      const current = new Set(day?.supplementsCompleted ?? []);
      const snapshots = clone(day?.supplementSnapshots ?? {});
      if (action.completed) {
        current.add(action.itemId);
        const canonical = canonicalItem(item);
        snapshots[action.itemId] = {
          id: canonical.id,
          type: canonical.type,
          name: canonical.name,
          servingLabel: canonical.servingLabel,
          perServing: canonical.perServing,
          provenance: canonical.provenance,
          schedule: clone(canonical.schedule ?? {})
        };
      } else {
        current.delete(action.itemId);
        delete snapshots[action.itemId];
      }
      return { ...(day ?? {}), supplementsCompleted: [...current], supplementSnapshots: snapshots };
    });
  }

  function lines(value) {
    return String(value ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  function provenanceFromForm(formData, definition, previousValue, amount, previous = {}) {
    const requestedSource = formData.get(`source_${definition.key}`)
      ?? previous.source
      ?? 'manual';
    const requestedConfidence = formData.get(`confidence_${definition.key}`)
      ?? previous.confidence
      ?? 'medium';
    if (!NUTRIENT_SOURCES.some(option => option.id === requestedSource)) {
      throw new TypeError(`${definition.label} source is invalid`);
    }
    if (!CONFIDENCE_LEVELS.some(option => option.id === requestedConfidence)) {
      throw new TypeError(`${definition.label} confidence is invalid`);
    }
    if (!Number.isFinite(previousValue)) {
      return { source: requestedSource, confidence: requestedConfidence };
    }
    if (amount !== previousValue) {
      return { source: 'manual', confidence: requestedConfidence };
    }
    const sourceChanged = requestedSource !== previous.source;
    const confidenceChanged = requestedConfidence !== previous.confidence;
    if (!sourceChanged && !confidenceChanged) return clone(previous);
    if (sourceChanged) return { source: requestedSource, confidence: requestedConfidence };
    return { ...clone(previous), confidence: requestedConfidence };
  }

  function itemFromConfirmation(formData, { allowIncomplete = false } = {}) {
    const type = formData.get('type');
    if (!LIBRARY_ITEM_TYPES.some(option => option.id === type)) throw new TypeError('Library item type is invalid');
    const name = String(formData.get('name') ?? '').trim();
    const servingLabel = String(formData.get('servingLabel') ?? '').trim();
    if (!allowIncomplete && (!name || !servingLabel)) {
      throw new TypeError('Name and household serving label are required');
    }
    const perServing = clone(state.draft?.item?.perServing ?? {});
    const provenance = clone(state.draft?.item?.provenance ?? {});
    const definitions = [...MACRO_NUTRIENTS, ...NUTRIENTS.filter(nutrient => (
      !MACRO_NUTRIENTS.some(macro => macro.key === nutrient.key)
    ))];
    for (const definition of definitions) {
      const raw = formData.get(`nutrient_${definition.key}`);
      if (raw === null) continue;
      if (raw === '') {
        if (definition.group) {
          if (perServing[definition.group]) {
            delete perServing[definition.group][definition.key];
            if (!Object.keys(perServing[definition.group]).length) delete perServing[definition.group];
          }
        } else {
          delete perServing[definition.key];
        }
        delete provenance[definition.key];
        continue;
      }
      const previousValue = nutrientValue(state.draft?.item?.perServing ?? {}, definition);
      const entered = finiteNonNegative(raw, definition.label);
      // The form shows values without floating-point noise; an unchanged display keeps the exact stored value.
      const amount = Number.isFinite(previousValue)
        && Math.abs(entered - previousValue) <= 1e-9 * Math.max(1, Math.abs(previousValue)) ? previousValue : entered;
      if (definition.group) {
        perServing[definition.group] ??= {};
        perServing[definition.group][definition.key] = amount;
      } else {
        perServing[definition.key] = amount;
      }
      provenance[definition.key] = provenanceFromForm(
        formData,
        definition,
        previousValue,
        amount,
        provenance[definition.key]
      );
    }

    const itemId = String(formData.get('itemId') ?? '').trim();
    const knownProvenance = Object.values(provenance);
    const commonConfidence = knownProvenance.length
      && knownProvenance.every(record => record.confidence === knownProvenance[0].confidence)
      ? knownProvenance[0].confidence
      : null;
    const item = {
      id: itemId || nextId('library'),
      type,
      name,
      servingLabel,
      perServing,
      provenance,
      confidence: commonConfidence,
      assumptions: lines(formData.get('assumptions')),
      components: lines(formData.get('components')).map(component => ({ name: component })),
      favorite: formData.has('favorite'),
      verified: knownProvenance.length > 0 && knownProvenance.every(record => record.source === 'label')
    };
    if (type === 'supplement') {
      const frequency = ['daily', 'weekly', 'custom'].includes(formData.get('scheduleFrequency'))
        ? formData.get('scheduleFrequency')
        : 'daily';
      const days = formData.getAll('scheduleDays')
        .map(Number)
        .filter(day => Number.isInteger(day) && day >= 0 && day <= 6);
      item.schedule = { frequency, days: [...new Set(days)].sort((left, right) => left - right) };
    }
    return item;
  }

  function openLibraryItem(itemId, mode = 'library') {
    const item = store.get('library').find(candidate => candidate.id === itemId);
    if (!item) throw new Error(`Library item not found: ${itemId}`);
    state.draft = { kind: 'confirmation', mode, item: clone(item), servings: 1 };
  }

  function openLogEntry(entryId) {
    const entry = (store.get('log')[state.selectedDate] ?? []).find(candidate => candidate.id === entryId);
    if (!entry) throw new Error(`Log entry not found: ${entryId}`);
    state.draft = {
      kind: 'confirmation',
      mode: 'logEdit',
      entryId: entry.id,
      lockedType: entry.type,
      servings: entry.servings,
      item: {
        id: entry.itemId,
        type: entry.type,
        name: entry.name,
        servingLabel: entry.servingLabel,
        perServing: clone(entry.perServing),
        provenance: clone(entry.provenance ?? {}),
        confidence: entry.confidence,
        assumptions: clone(entry.assumptions ?? []),
        components: clone(entry.components ?? [])
      }
    };
  }

  function acceptRecommendation(id) {
    const recommendations = store.get('recommendations');
    const recommendation = recommendations.find(item => item.id === id);
    if (!recommendation || recommendation.status !== 'pending') return;
    refreshProgress();
    const refreshed = store.get('recommendations').find(item => item.id === id);
    if (!refreshed || refreshed.status !== 'pending') return;
    if (!sameRecommendationEvidence(recommendation, refreshed)) {
      const now = clock().toISOString();
      store.update('recommendations', items => [
        ...items.map(item => item.id === id
          ? { ...recommendation, status: 'superseded', supersededAt: now }
          : item),
        { ...refreshed, id: nextId('recommendation'), createdAt: now,
          updatedAt: undefined, status: 'pending' }
      ]);
      return;
    }
    const change = Number(recommendation.changeCalories);
    if (!Number.isFinite(change)) throw new TypeError('Recommendation calorie change must be numeric');
    const targets = store.get('targets');
    const effective = resolveEffectiveTargets(targets);
    if (!effective) return;
    const previousAverageCalories = effective.averageCalories;
    const nextAverageCalories = Math.max(effective.bmr, previousAverageCalories + change);
    const appliedChangeCalories = nextAverageCalories - previousAverageCalories;
    store.set('targets', {
      ...targets,
      overrides: { ...targets.overrides, averageCalories: nextAverageCalories }
    });
    store.update('recommendations', items => items.map(item => item.id === id
      ? { ...item, status: 'accepted', acceptedAt: clock().toISOString(),
        requestedChangeCalories: change, appliedChangeCalories,
        previousAverageCalories, newAverageCalories: nextAverageCalories }
      : item));
  }

  function sameRecommendationEvidence(left, right) {
    const evidence = item => ({ changeCalories: item.changeCalories,
      observedPercentPerWeek: item.observedPercentPerWeek, reason: item.reason, basis: item.basis });
    return JSON.stringify(evidence(left)) === JSON.stringify(evidence(right));
  }

  function refreshProgress() {
    const targets = resolveEffectiveTargets(store.get('targets'));
    if (!targets) return;
    const recommendation = buildAdjustmentRecommendation(store.get('bodyMetrics'), targets, clock());
    let existing = store.get('recommendations');
    const sameBasis = item => recommendation
      && item.basis?.startDate === recommendation.basis.startDate
      && item.basis?.endDate === recommendation.basis.endDate;
    const pending = existing.find(item => item.status === 'pending');
    if (pending) {
      if (sameBasis(pending)) {
        if (!sameRecommendationEvidence(pending, recommendation)) {
          store.set('recommendations', existing.map(item => item.id === pending.id
            ? { ...item, ...recommendation, updatedAt: clock().toISOString() }
            : item));
        }
        return;
      }
      existing = existing.map(item => item.id === pending.id
        ? { ...item, status: 'superseded', supersededAt: clock().toISOString() }
        : item);
      store.set('recommendations', existing);
    }
    if (!recommendation || existing.some(item => sameBasis(item)
      && ['accepted', 'dismissed'].includes(item.status))) return;
    store.set('recommendations', [...existing, {
      ...recommendation,
      id: nextId('recommendation'),
      createdAt: clock().toISOString(),
      status: 'pending'
    }]);
  }

  function saveBodyMetric(entry) {
    assertDate(entry?.date);
    if (!Number.isFinite(entry.weightKg) || entry.weightKg < 25 || entry.weightKg > 400) {
      throw new RangeError('Weight must be between 25 and 400 kg');
    }
    if (entry.waistCm !== undefined && entry.waistCm !== null
      && (!Number.isFinite(entry.waistCm) || entry.waistCm < 20 || entry.waistCm > 300)) {
      throw new RangeError('Waist must be between 20 and 300 cm');
    }
    const canonical = { date: entry.date, weightKg: entry.weightKg,
      ...(entry.waistCm === undefined || entry.waistCm === null ? {} : { waistCm: entry.waistCm }) };
    store.update('bodyMetrics', entries => [...entries.filter(item => item.date !== entry.date), canonical]
      .sort((left, right) => left.date.localeCompare(right.date)));
    refreshProgress();
  }

  function dismissRecommendation(id) {
    store.update('recommendations', recommendations => recommendations.map(item => (
      item.id === id && item.status === 'pending'
        ? { ...item, status: 'dismissed', dismissedAt: clock().toISOString() }
        : item
    )));
  }

  function dispatch(action) {
    if (!action || typeof action.type !== 'string') throw new TypeError('Actions require a type');
    if (['OPEN_MANUAL_ENTRY', 'OPEN_LIBRARY_ITEM', 'OPEN_LOG_ENTRY', 'RESET_DATA', 'RESTART_ONBOARDING'].includes(action.type)
      && (analysisController || state.analysis)) cancelAnalysis();
    switch (action.type) {
      case 'APPLY_UPDATE':
        return pwa?.applyUpdate() ?? false;
      case 'EXPORT_DATA':
        if (action.includeSecrets && action.confirmSecrets !== true) throw new Error('Confirm secret inclusion before export');
        return store.exportData({ includeSecrets: action.includeSecrets === true });
      case 'IMPORT_DATA':
        if (action.includeSecrets && action.confirmSecrets !== true) throw new Error('Confirm secret inclusion before import');
        try {
          store.importData(action.json, { includeSecrets: action.includeSecrets === true });
        } catch {
          throw new Error('Import file failed validation or could not be saved. Existing data was kept.');
        }
        state.route = 'today';
        state.draft = null;
        state.analysis = null;
        waterUndo.clear();
        break;
      case 'COMPLETE_ONBOARDING':
        completeOnboarding(action);
        break;
      case 'SET_UNITS':
        if (!['metric', 'imperial'].includes(action.units)) throw new TypeError('Units must be metric or imperial');
        store.update('settings', settings => ({ ...settings, units: action.units }));
        break;
      case 'SAVE_PROFILE': {
        const profile = clone(action.profile);
        store.set('profile', profile);
        store.update('targets', targets => ({
          ...targets,
          computed: targets.autoCompute === false ? targets.computed : computeTargets(profile)
        }));
        break;
      }
      case 'SET_TARGET_OVERRIDES':
        store.update('targets', targets => ({ ...targets, overrides: clone(action.overrides ?? {}) }));
        break;
      case 'SET_TRACKED_NUTRIENTS':
        store.update('settings', settings => ({ ...settings, trackedNutrients: [...new Set(action.ids ?? [])] }));
        break;
      case 'SET_TRAINING_BEHAVIOR':
        store.update('settings', settings => ({ ...settings, trainingDayToggleEnabled: Boolean(action.enabled) }));
        break;
      case 'SET_WATER_INCREMENTS':
        store.update('settings', settings => ({
          ...settings,
          waterGlassMl: finiteNonNegative(action.glassMl, 'Glass amount'),
          waterBottleMl: finiteNonNegative(action.bottleMl, 'Bottle amount')
        }));
        break;
      case 'SET_INTEGRATIONS':
        store.update('settings', settings => ({
          ...settings,
          provider: ['gemini', 'anthropic'].includes(action.provider) ? action.provider
            : String(action.anthropicApiKey ?? '').trim() && !String(action.geminiApiKey ?? '').trim() ? 'anthropic' : 'gemini',
          geminiApiKey: String(action.geminiApiKey ?? settings.geminiApiKey ?? '').trim(),
          geminiModel: String(action.geminiModel ?? settings.geminiModel ?? '').trim() || 'gemini-3.8-flash',
          anthropicApiKey: String(action.anthropicApiKey ?? '').trim(),
          foodDataCentralApiKey: String(action.foodDataCentralApiKey ?? '').trim(),
          model: String(action.model ?? settings.model)
        }));
        break;
      case 'RESTART_ONBOARDING':
        store.update('meta', meta => ({ ...meta, onboardingComplete: false }));
        break;
      // These state actions are the stable controller contract for the Library,
      // Today, and Progress UI tasks that build on this shell.
      case 'SAVE_LIBRARY_ITEM':
        saveLibraryItem(action.item);
        break;
      case 'DELETE_LIBRARY_ITEM':
        store.update('library', library => library.filter(item => item.id !== action.itemId));
        if (state.draft?.item?.id === action.itemId) state.draft = null;
        break;
      case 'LOG_ITEM':
        logItem(action);
        break;
      case 'EDIT_LOG_ENTRY':
        editLogEntry(action);
        break;
      case 'DELETE_LOG_ENTRY':
        updateDatedMap('log', action.date, entries => (entries ?? []).filter(entry => entry.id !== action.entryId));
        break;
      case 'TOGGLE_SUPPLEMENT':
        toggleSupplement(action);
        break;
      case 'OPEN_MANUAL_ENTRY':
        state.draft = {
          kind: 'confirmation',
          mode: 'manual',
          servings: 1,
          item: {
            id: null,
            type: action.itemType && LIBRARY_ITEM_TYPES.some(type => type.id === action.itemType) ? action.itemType : 'meal',
            name: '',
            servingLabel: '',
            perServing: {},
            provenance: {},
            assumptions: [],
            components: [],
            favorite: false
          }
        };
        break;
      case 'OPEN_LIBRARY_ITEM':
        openLibraryItem(action.itemId);
        break;
      case 'OPEN_LOG_ENTRY':
        openLogEntry(action.entryId);
        break;
      case 'CLOSE_CONFIRMATION':
        state.draft = null;
        break;
      case 'SET_LIBRARY_QUERY':
        state.libraryQuery = String(action.query ?? '');
        break;
      case 'SET_SELECTED_DATE':
        assertDate(action.date);
        state.selectedDate = action.date;
        state.dialog = null;
        break;
      case 'OPEN_NUTRIENT_DETAILS':
        if (!NUTRIENTS.some(nutrient => nutrient.id === action.nutrientId)) {
          throw new Error(`Unknown nutrient: ${action.nutrientId}`);
        }
        if (action.nutrientOrigin !== 'attention') state.coverageOpen = true;
        state.dialog = {
          kind: 'nutrientDetails',
          nutrientId: action.nutrientId,
          nutrientOrigin: ['coverage', 'attention'].includes(action.nutrientOrigin)
            ? action.nutrientOrigin
            : 'coverage'
        };
        break;
      case 'CLOSE_NUTRIENT_DETAILS':
        pendingNutrientFocus = state.dialog?.kind === 'nutrientDetails'
          ? {
              nutrientId: state.dialog.nutrientId,
              nutrientOrigin: state.dialog.nutrientOrigin ?? 'coverage'
            }
          : null;
        documentRef?.querySelector?.('.nutrient-dialog')?.close?.();
        state.dialog = null;
        break;
      case 'ADD_WATER': {
        assertDate(action.date);
        const amount = finiteNonNegative(action.ml, 'Water amount');
        const previous = store.get('water')[action.date] ?? 0;
        const stack = waterUndo.get(action.date) ?? [];
        stack.push(previous);
        waterUndo.set(action.date, stack);
        updateDatedMap('water', action.date, total => (total ?? 0) + amount);
        break;
      }
      case 'UNDO_WATER': {
        assertDate(action.date);
        const stack = waterUndo.get(action.date) ?? [];
        if (stack.length) {
          const previous = stack.pop();
          waterUndo.set(action.date, stack);
          updateDatedMap('water', action.date, () => previous);
        }
        break;
      }
      case 'SET_TRAINING_DAY':
        updateDatedMap('dayState', action.date, day => ({ ...(day ?? {}), trainingDay: Boolean(action.trainingDay), trainingSource: 'manual' }));
        break;
      case 'SAVE_BODY_METRIC':
        saveBodyMetric(action.entry);
        state.editingBodyMetricDate = null;
        break;
      case 'EDIT_BODY_METRIC':
        assertDate(action.date);
        state.editingBodyMetricDate = action.date;
        break;
      case 'CANCEL_BODY_METRIC_EDIT':
        state.editingBodyMetricDate = null;
        break;
      case 'DELETE_BODY_METRIC':
        assertDate(action.date);
        store.update('bodyMetrics', entries => entries.filter(entry => entry.date !== action.date));
        if (state.editingBodyMetricDate === action.date) state.editingBodyMetricDate = null;
        refreshProgress();
        break;
      case 'REFRESH_PROGRESS':
        state.progressDate = localDate(clock());
        refreshProgress();
        break;
      case 'ACCEPT_RECOMMENDATION':
        acceptRecommendation(action.id);
        break;
      case 'DISMISS_RECOMMENDATION':
        dismissRecommendation(action.id);
        break;
      case 'DELETE_RECOMMENDATION':
        store.update('recommendations', recommendations => recommendations.filter(item => item.id !== action.id));
        break;
      case 'RESET_DATA':
        if (action.confirmation !== 'RESET ALL DATA') throw new Error('Type RESET ALL DATA to confirm');
        store.reset();
        state.route = 'today';
        state.draft = null;
        waterUndo.clear();
        break;
      default:
        throw new Error(`Unknown action: ${action.type}`);
    }
    render();
    if (['COMPLETE_ONBOARDING', 'RESTART_ONBOARDING', 'RESET_DATA', 'IMPORT_DATA'].includes(action.type)) resetScroll();
  }

  function navigate(route) {
    if (!VALID_ROUTES.has(route)) throw new Error(`Unknown route: ${route}`);
    if (analysisController || state.analysis) cancelAnalysis();
    state.route = route;
    if (route === 'progress') state.progressDate = localDate(clock());
    state.dialog = null;
    state.draft = null;
    state.notice = null;
    state.dataStatus = '';
    state.usda = null;
    render();
    resetScroll();
    focusHeading();
  }

  function handleClick(event) {
    const control = event.target.closest?.('[data-action]');
    if (!control) return;
    if (control.tagName !== 'FORM') state.notice = null;
    if (control.dataset.action === 'navigate') navigate(control.dataset.route);
    if (control.dataset.action === 'restart-onboarding') dispatch({ type: 'RESTART_ONBOARDING' });
    if (control.dataset.action === 'install-app') pwa?.install();
    if (control.dataset.action === 'apply-update') dispatch({ type: 'APPLY_UPDATE' });
    if (control.dataset.action === 'open-manual-entry') dispatch({ type: 'OPEN_MANUAL_ENTRY' });
    if (control.dataset.action === 'cancel-analysis') cancelAnalysis();
    if (control.dataset.action === 'retry-usda') return retryFoodSearch();
    if (['open-library-item', 'edit-library-item'].includes(control.dataset.action)) {
      dispatch({ type: 'OPEN_LIBRARY_ITEM', itemId: control.dataset.itemId });
    }
    if (control.dataset.action === 'delete-library-item') {
      dispatch({ type: 'DELETE_LIBRARY_ITEM', itemId: control.dataset.itemId });
    }
    if (control.dataset.action === 'edit-log-entry') {
      dispatch({ type: 'OPEN_LOG_ENTRY', entryId: control.dataset.entryId });
    }
    if (control.dataset.action === 'delete-log-entry') {
      dispatch({ type: 'DELETE_LOG_ENTRY', date: state.selectedDate, entryId: control.dataset.entryId });
    }
    if (control.dataset.action === 'edit-body-metric') dispatch({ type: 'EDIT_BODY_METRIC', date: control.dataset.date });
    if (control.dataset.action === 'cancel-body-metric-edit') dispatch({ type: 'CANCEL_BODY_METRIC_EDIT' });
    if (control.dataset.action === 'delete-body-metric') dispatch({ type: 'DELETE_BODY_METRIC', date: control.dataset.date });
    if (control.dataset.action === 'refresh-progress') dispatch({ type: 'REFRESH_PROGRESS' });
    if (control.dataset.action === 'accept-recommendation') dispatch({ type: 'ACCEPT_RECOMMENDATION', id: control.dataset.id });
    if (control.dataset.action === 'dismiss-recommendation') dispatch({ type: 'DISMISS_RECOMMENDATION', id: control.dataset.id });
    if (control.dataset.action === 'close-confirmation') dispatch({ type: 'CLOSE_CONFIRMATION' });
    if (control.dataset.action === 'toggle-supplement') {
      dispatch({
        type: 'TOGGLE_SUPPLEMENT',
        date: state.selectedDate,
        itemId: control.dataset.itemId,
        completed: control.dataset.completed === 'true'
      });
    }
    if (control.dataset.action === 'toggle-training') {
      const current = store.get('dayState')[state.selectedDate]?.trainingDay ?? false;
      dispatch({ type: 'SET_TRAINING_DAY', date: state.selectedDate, trainingDay: !current });
    }
    if (control.dataset.action === 'shift-selected-date') {
      dispatch({
        type: 'SET_SELECTED_DATE',
        date: shiftLocalDate(state.selectedDate, Number(control.dataset.days))
      });
    }
    if (control.dataset.action === 'add-water') {
      dispatch({ type: 'ADD_WATER', date: state.selectedDate, ml: Number(control.dataset.ml) });
    }
    if (control.dataset.action === 'undo-water') {
      dispatch({ type: 'UNDO_WATER', date: state.selectedDate });
    }
    if (control.dataset.action === 'open-nutrient-details') {
      dispatch({
        type: 'OPEN_NUTRIENT_DETAILS',
        nutrientId: control.dataset.nutrientId,
        nutrientOrigin: control.dataset.nutrientOrigin
      });
    }
    if (control.dataset.action === 'toggle-coverage') {
      state.coverageOpen = !state.coverageOpen;
      render();
    }
    if (control.dataset.action === 'close-nutrient-details') {
      dispatch({ type: 'CLOSE_NUTRIENT_DETAILS' });
    }
  }

  function handleChange(event) {
    const form = event.target.closest?.('form[data-action]');
    if (!form) return;
    if (form.dataset.action === 'complete-onboarding') {
      state.draft = draftFromForm(valuesFromForm(form), event.target.name);
      if (event.target.name === 'units' || !patchOnboardingTargets()) render();
    }
    if (form.dataset.action === 'confirm-item'
      && event.target.name === 'type'
      && state.draft?.mode !== 'logEdit') {
      const formData = valuesFromForm(form);
      state.draft = {
        ...state.draft,
        item: itemFromConfirmation(formData, { allowIncomplete: true }),
        servings: formData.get('servings') ?? state.draft?.servings
      };
      render();
    }
    if (form.dataset.action === 'select-date' && event.target.name === 'selectedDate') {
      dispatch({ type: 'SET_SELECTED_DATE', date: event.target.value });
    }
  }

  function handleSubmit(event) {
    const form = event.target.closest?.('form[data-action]');
    if (!form) return;
    event.preventDefault();
    const formData = valuesFromForm(form);
    state.notice = SAVED_MESSAGES[form.dataset.action]
      ? { form: form.dataset.action, tone: 'status', text: SAVED_MESSAGES[form.dataset.action] }
      : null;
    switch (form.dataset.action) {
      case 'export-data': {
        const includeSecrets = formData.has('includeSecrets');
        if (includeSecrets && !confirmFn('Include API keys in this download? Anyone with the file can read them.')) {
          state.dataStatus = 'Export canceled. API keys were not downloaded.';
          render();
          return;
        }
        try {
          const contents = dispatch({ type: 'EXPORT_DATA', includeSecrets, confirmSecrets: includeSecrets });
          downloadFn(`longevity-tracker-${localDate(clock())}.json`, contents);
          state.dataStatus = 'Export downloaded.';
          try {
            store.update('meta', meta => ({ ...meta, lastExportAt: clock().toISOString() }));
          } catch {
            // The file is already downloaded; only the reminder date could not be saved.
          }
        } catch {
          state.dataStatus = 'Export could not be downloaded. Try again.';
        }
        render();
        return;
      }
      case 'import-data': {
        const file = formData.get('file');
        const includeSecrets = formData.has('includeSecrets');
        if (!file || typeof file.text !== 'function') {
          state.dataStatus = 'Choose a JSON export file to import.';
          render();
          return;
        }
        if (includeSecrets && !confirmFn('Include API keys from this file? Imported keys will be saved on this device.')) {
          state.dataStatus = 'Import canceled. No data was changed.';
          render();
          return;
        }
        return file.text().then(json => {
          dispatch({ type: 'IMPORT_DATA', json, includeSecrets, confirmSecrets: includeSecrets });
          state.dataStatus = 'Import complete.';
          render();
        }).catch(() => {
          state.dataStatus = 'Import file failed validation or could not be saved. Existing data was kept.';
          render();
        });
      }
      case 'usda-search': {
        const query = String(formData.get('query') ?? '').trim();
        if (!query) return;
        state.usda = { status: 'loading', query };
        render();
        return searchFoods(query, store.get('settings').foodDataCentralApiKey, fetchFn)
          .then(foods => { state.usda = { status: 'results', query, foods: rankCandidates({ name: query, usdaSearch: query }, foods).slice(0, 8) }; })
          .catch(error => { state.usda = { status: 'error', query, error: error?.name === 'AnalysisError' ? error.message : 'USDA food search is unavailable.' }; })
          .finally(() => render());
      }
      case 'usda-pick': {
        const food = state.usda?.foods?.find(candidate => String(candidate.fdcId) === String(formData.get('fdcId')));
        const grams = Number(formData.get('grams'));
        if (!food || !Number.isFinite(grams) || grams <= 0) throw new TypeError('Choose a food and enter an amount in grams.');
        const amount = `${Number(grams.toPrecision(6))} g`;
        const resolved = resolveDraft({ kind: 'description', name: food.description, servingLabel: amount, confidence: 'high', assumptions: [],
          totalServings: 1, labelNutrients: {}, labelServingGrams: null,
          components: [{ name: food.description, householdAmount: amount, estimatedGrams: grams, usdaSearch: state.usda.query,
            confidence: 'high', candidates: [food], selectedFdcId: food.fdcId }] });
        state.usda = null;
        openAnalysisReview(resolved);
        return;
      }
      case 'analyze-food':
        return startAnalysis({ kind: formData.get('kind'), text: formData.get('text'), image: formData.get('image')?.size ? formData.get('image') : null });
      case 'retry-analysis':
        if (state.analysis?.status === 'error') return startAnalysis({ kind: state.analysis.kind, text: state.analysis.text,
          clarificationHistory: state.analysis.clarificationHistory, image: formData.get('image')?.size ? formData.get('image') : null });
        return;
      case 'answer-clarification': {
        const current = state.analysis;
        if (current?.status !== 'needs_clarification') return;
        const clarificationHistory = [...(current.clarificationHistory ?? []), ...current.questions.map(question =>
          ({ id: question.id, prompt: question.prompt, answer: String(formData.get(question.id) ?? '').trim() }))];
        return startAnalysis({ kind: current.kind, text: current.text, clarificationHistory,
          image: formData.get('image')?.size ? formData.get('image') : null });
      }
      case 'select-analysis-candidates': {
        if (state.analysis?.status !== 'candidates') return;
        const selections = Object.fromEntries(state.analysis.draft.components.map((component, index) =>
          [index, formData.get(`candidate_${index}`)]).filter(([, value]) => value));
        const resolved = resolveDraft(state.analysis.draft, selections);
        if (resolved.pendingCandidates.length) {
          state.analysis = { ...state.analysis, error: 'Choose a food record for each matched ingredient, or use manual entry.' };
          render();
        } else openAnalysisReview(resolved);
        return;
      }
      case 'complete-onboarding': {
        const draft = draftFromForm(formData);
        dispatch({
          type: 'COMPLETE_ONBOARDING',
          profile: draft.profile,
          units: draft.units,
          usesSupplements: draft.usesSupplements,
          overrides: draft.overrides
        });
        break;
      }
      case 'save-profile':
        dispatch({ type: 'SAVE_PROFILE', profile: profileFromForm(formData, store.get('profile')) });
        break;
      case 'save-target-overrides': {
        dispatch({ type: 'SET_TARGET_OVERRIDES', overrides: targetOverridesFromForm(formData) });
        break;
      }
      case 'set-units':
        dispatch({ type: 'SET_UNITS', units: formData.get('units') });
        break;
      case 'save-tracked-nutrients':
        dispatch({ type: 'SET_TRACKED_NUTRIENTS', ids: formData.getAll('trackedNutrients') });
        break;
      case 'save-training-behavior':
        dispatch({ type: 'SET_TRAINING_BEHAVIOR', enabled: formData.has('trainingDayToggleEnabled') });
        break;
      case 'save-water-increments': {
        const imperial = formData.get('units') === 'imperial';
        const glass = formNumber(formData, 'waterGlass');
        const bottle = formNumber(formData, 'waterBottle');
        dispatch({ type: 'SET_WATER_INCREMENTS', glassMl: imperial ? flOzToMl(glass) : glass, bottleMl: imperial ? flOzToMl(bottle) : bottle });
        break;
      }
      case 'save-integrations':
        dispatch({
          type: 'SET_INTEGRATIONS',
          provider: formData.get('provider'),
          geminiApiKey: formData.get('geminiApiKey'),
          geminiModel: formData.get('geminiModel'),
          anthropicApiKey: formData.get('anthropicApiKey'),
          foodDataCentralApiKey: formData.get('foodDataCentralApiKey'),
          model: formData.get('model')
        });
        break;
      case 'search-library':
        dispatch({ type: 'SET_LIBRARY_QUERY', query: formData.get('query') });
        break;
      case 'select-date':
        dispatch({ type: 'SET_SELECTED_DATE', date: formData.get('selectedDate') });
        break;
      case 'save-body-metric': {
        const imperial = formData.get('units') === 'imperial';
        const weight = formNumber(formData, 'weight');
        const waistRaw = formData.get('waist');
        const waist = waistRaw === null || String(waistRaw).trim() === '' ? null : formNumber(formData, 'waist');
        dispatch({ type: 'SAVE_BODY_METRIC', entry: {
          date: formData.get('date'),
          weightKg: imperial ? clampImperialRoundTrip(lbToKg(weight), 25, 400) : weight,
          ...(waist === null ? {} : { waistCm: imperial ? clampImperialRoundTrip(inToCm(waist), 20, 300) : waist })
        } });
        break;
      }
      case 'confirm-item': {
        if (state.draft?.mode === 'logEdit'
          && formData.get('type') !== state.draft.lockedType) {
          render();
          break;
        }
        const item = itemFromConfirmation(formData);
        const servings = finiteNonNegative(formData.get('servings'), 'Servings');
        const intent = event.submitter?.value;
        if (intent === 'save') {
          dispatch({ type: 'SAVE_LIBRARY_ITEM', item });
          state.draft = null;
          state.route = 'library';
          render();
        } else if (intent === 'log' || intent === 'complete') {
          if (item.type === 'supplement') {
            saveLibraryItem(item);
            toggleSupplement({ date: state.selectedDate, itemId: item.id, completed: true });
          } else if (state.draft?.mode === 'logEdit') {
            dispatch({
              type: 'EDIT_LOG_ENTRY',
              date: state.selectedDate,
              entryId: state.draft.entryId,
              servings,
              item
            });
          } else {
            dispatch({ type: 'LOG_ITEM', date: state.selectedDate, item, servings });
          }
          state.draft = null;
          state.route = 'today';
          render();
        } else {
          throw new TypeError('Choose Save to Library or Add to date');
        }
        break;
      }
      case 'reset-data':
        try {
          dispatch({ type: 'RESET_DATA', confirmation: formData.get('confirmation') });
          state.dataStatus = '';
        } catch {
          state.notice = { form: 'reset-data', tone: 'error', text: 'Type RESET ALL DATA exactly to erase local data.' };
          render();
        }
        break;
    }
  }

  function isEditing() {
    const active = documentRef?.activeElement;
    const root = getRoot();
    return Boolean(state.draft) || Boolean(active && typeof root?.contains === 'function' && root.contains(active)
      && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName));
  }

  // Workout days published from Lift arrive in the background; like update notices, they never
  // redraw while something is being edited. The next render shows them.
  async function syncActivity() {
    try {
      const response = await activityFetch(activityUrl, { cache: 'no-store' });
      if (!response?.ok) return false;
      const activity = parseActivity(await response.text());
      if (!activity) return false;
      const { dayState, changed } = mergeActivity(store.get('dayState'), activity);
      if (changed) store.set('dayState', dayState);
      if (store.get('meta').activitySyncedAt !== activity.generatedAt) {
        store.update('meta', meta => ({ ...meta, activitySyncedAt: activity.generatedAt }));
      }
      if (store.get('meta').onboardingComplete && !isEditing()) render();
      return changed;
    } catch {
      return false;
    }
  }

  function showError(error, event) {
    const formAction = event?.type === 'submit' ? event.target.closest?.('form[data-action]')?.dataset?.action : null;
    state.notice = { form: formAction ?? null, tone: 'error', text: userMessage(error) };
    render();
  }

  // Every user action reports failures on screen rather than failing silently.
  function guarded(handler) {
    return event => {
      try {
        const result = handler(event);
        if (typeof result?.catch === 'function') result.catch(error => showError(error, event));
        return result;
      } catch (error) {
        showError(error, event);
        return undefined;
      }
    };
  }

  function start() {
    const root = getRoot();
    if (root && !listenersBound) {
      root.addEventListener('click', guarded(handleClick));
      root.addEventListener('submit', guarded(handleSubmit));
      root.addEventListener('change', guarded(handleChange));
      listenersBound = true;
      pwa = pwaFactory({
        onStatus: status => { state.installStatus = status; refreshPwaRegions(); },
        onInstall: available => { state.canInstall = available; refreshPwaRegions(); },
        onUpdate: ready => { state.updateReady = ready; refreshPwaRegions(); }
      });
      documentRef?.addEventListener?.('visibilitychange', () => { if (documentRef.visibilityState === 'visible') syncActivity(); });
      documentRef?.defaultView?.addEventListener?.('online', () => syncActivity());
    }
    render();
    syncActivity();
  }

  return { start, navigate, getState: () => clone(state), dispatch, syncActivity };
}

if (typeof document !== 'undefined' && typeof localStorage !== 'undefined') {
  const store = createStore({ storage: localStorage });
  createApp({ store }).start();
}

export { HUEL_SEEDS };
