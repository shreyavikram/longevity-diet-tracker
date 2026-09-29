export const SCHEMA_VERSION = 3;

export const STORAGE_KEYS = Object.freeze([
  'profile',
  'targets',
  'settings',
  'library',
  'log',
  'bodyMetrics',
  'water',
  'dayState',
  'recommendations',
  'meta'
]);

export const DEFAULT_TRACKED_NUTRIENTS = Object.freeze([
  'b12', 'vitD', 'ala', 'epaDha', 'iron', 'calcium', 'zinc', 'iodine',
  'selenium', 'magnesium', 'potassium', 'folate', 'choline', 'sodium',
  'saturatedFat', 'freeSugar', 'transFat'
]);

export const LIBRARY_ITEM_TYPES = Object.freeze([
  { id: 'meal', label: 'Meal' },
  { id: 'recipe', label: 'Recipe' },
  { id: 'packaged', label: 'Packaged food' },
  { id: 'supplement', label: 'Supplement' }
]);

export const MACRO_NUTRIENTS = Object.freeze([
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'proteinG', label: 'Protein', unit: 'g' },
  { key: 'carbsG', label: 'Carbohydrate', unit: 'g' },
  { key: 'fatG', label: 'Fat', unit: 'g' },
  { key: 'fiberG', label: 'Fiber', unit: 'g' }
]);

// Nutrients stored as source facts but not tracked as daily targets. Added sugar is kept because it is the
// label fact free sugar is derived from, but it is not interchangeable with free sugar.
export const SOURCE_NUTRIENTS = Object.freeze([
  { key: 'totalSugarG', label: 'Total sugar', unit: 'g' },
  { key: 'addedSugarG', label: 'Added sugar', unit: 'g' },
  { key: 'intrinsicSugarG', label: 'Intrinsic sugar', unit: 'g' },
  { key: 'sugarAlcoholG', label: 'Sugar alcohol', unit: 'g' }
]);

// Editable heart and glucose planning references (AHA sodium and fat guidance; WHO free sugars).
export const CARDIOMETABOLIC_TARGET_DEFAULTS = Object.freeze({
  freeSugarMaxG: 15,
  fiberMinG: 25,
  fiberPreferredG: 35,
  saturatedFatPercentMax: 6,
  transFatMaxG: 0,
  sodiumIdealMaxMg: 1500,
  sodiumHardMaxMg: 2300,
  fiberCarbRatioDenominatorMax: 10,
  carbsPercentMin: 33,
  carbsPercentMax: 42,
  fatPercentMin: 25,
  fatPercentMax: 35,
  mealCarbsMaxG: 50,
  mealGlMax: 20,
  dailyGlMax: 100,
  solubleFiberMinG: 7,
  solubleFiberPreferredG: 10
});

export const NUTRIENT_SOURCES = Object.freeze([
  { id: 'manual', label: 'User-entered value' },
  { id: 'label', label: 'Product label' },
  { id: 'mixed', label: 'Mixed sources' },
  { id: 'saved', label: 'Saved verified item' },
  { id: 'usdaBranded', label: 'USDA branded food' },
  { id: 'usda', label: 'USDA reference food' },
  { id: 'ai', label: 'AI estimate' }
]);

export const CONFIDENCE_LEVELS = Object.freeze([
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' }
]);

export const WEEKDAYS = Object.freeze([
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
]);

export const NUTRIENTS = Object.freeze([
  { id: 'protein', label: 'Protein', key: 'proteinG', unit: 'g', targetMin: 130, kind: 'minimum', evidence: 'Training target', veganPriority: true },
  { id: 'fiber', label: 'Fiber', key: 'fiberG', unit: 'g', targetMin: 25, targetPreferred: 35, kind: 'minimum', evidence: 'Editable goal' },
  { id: 'solubleFiber', label: 'Soluble fiber', key: 'solubleFiberG', unit: 'g', targetMin: 7, targetPreferred: 10, kind: 'minimum', evidence: 'Portfolio diet LDL evidence' },
  { id: 'b12', label: 'Vitamin B12', key: 'b12Mcg', group: 'micros', unit: 'mcg', targetMin: 2.4, kind: 'minimum', evidence: 'RDA', veganPriority: true, citation: 'https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/' },
  { id: 'vitD', label: 'Vitamin D', key: 'vitDIu', group: 'micros', unit: 'IU', targetMin: 600, targetPreferred: 1000, upperLimit: 4000, kind: 'minimum', evidence: 'RDA and configurable range', veganPriority: true, citation: 'https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/' },
  { id: 'ala', label: 'ALA omega-3', key: 'alaG', group: 'micros', unit: 'g', targetMin: 1.1, kind: 'minimum', evidence: 'AI', veganPriority: true, citation: 'https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/' },
  { id: 'epaDha', label: 'EPA + DHA', key: 'epaDhaMg', group: 'micros', unit: 'mg', targetMin: 250, targetPreferred: 300, kind: 'minimum', evidence: 'Evidence-informed range', veganPriority: true, citation: 'https://ods.od.nih.gov/factsheets/Omega3FattyAcids-HealthProfessional/' },
  { id: 'iron', label: 'Iron', key: 'ironMg', group: 'micros', unit: 'mg', targetMin: 18, targetPreferred: 32, upperLimit: 45, kind: 'minimum', evidence: 'RDA plus vegan planning range', veganPriority: true, citation: 'https://ods.od.nih.gov/factsheets/Iron-Consumer/' },
  { id: 'calcium', label: 'Calcium', key: 'calciumMg', group: 'micros', unit: 'mg', targetMin: 1000, upperLimit: 2500, kind: 'minimum', evidence: 'RDA', veganPriority: true, citation: 'https://ods.od.nih.gov/factsheets/Calcium-HealthProfessional/' },
  { id: 'zinc', label: 'Zinc', key: 'zincMg', group: 'micros', unit: 'mg', targetMin: 11, upperLimit: 40, kind: 'minimum', evidence: 'Vegan planning target', veganPriority: true, citation: 'https://ods.od.nih.gov/factsheets/Zinc-HealthProfessional/' },
  { id: 'iodine', label: 'Iodine', key: 'iodineMcg', group: 'micros', unit: 'mcg', targetMin: 150, upperLimit: 1100, kind: 'minimum', evidence: 'RDA', veganPriority: true, citation: 'https://ods.od.nih.gov/factsheets/Iodine-HealthProfessional/' },
  { id: 'selenium', label: 'Selenium', key: 'seleniumMcg', group: 'micros', unit: 'mcg', targetMin: 55, upperLimit: 400, kind: 'minimum', evidence: 'RDA', veganPriority: true, citation: 'https://ods.od.nih.gov/factsheets/Selenium-HealthProfessional/' },
  { id: 'magnesium', label: 'Magnesium', key: 'magnesiumMg', group: 'micros', unit: 'mg', targetMin: 310, kind: 'minimum', evidence: 'RDA', citation: 'https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/' },
  { id: 'potassium', label: 'Potassium', key: 'potassiumMg', group: 'micros', unit: 'mg', targetMin: 2600, kind: 'minimum', evidence: 'AI', citation: 'https://ods.od.nih.gov/factsheets/Potassium-HealthProfessional/' },
  { id: 'folate', label: 'Folate', key: 'folateDfeMcg', group: 'micros', unit: 'mcg DFE', targetMin: 400, kind: 'minimum', evidence: 'RDA', citation: 'https://ods.od.nih.gov/factsheets/Folate-HealthProfessional/' },
  { id: 'choline', label: 'Choline', key: 'cholineMg', group: 'micros', unit: 'mg', targetMin: 425, upperLimit: 3500, kind: 'minimum', evidence: 'AI', citation: 'https://ods.od.nih.gov/factsheets/Choline-HealthProfessional/' },
  { id: 'sodium', label: 'Sodium', key: 'sodiumMg', group: 'micros', unit: 'mg', targetMax: 2300, idealMax: 1500, kind: 'maximum', evidence: 'AHA ideal 1,500 mg; limit 2,300 mg', citation: 'https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/sodium/how-much-sodium-should-i-eat-per-day' },
  { id: 'saturatedFat', label: 'Saturated fat', key: 'saturatedFatG', unit: 'g', percentEnergyMax: 6, kind: 'maximum', evidence: 'AHA heart-focused limit', citation: 'https://www.heart.org/en/healthy-living/healthy-eating/eat-smart/fats/fats-in-foods' },
  { id: 'freeSugar', label: 'Free sugar', key: 'freeSugarG', unit: 'g', targetMax: 15, kind: 'maximum', evidence: 'Editable goal' },
  { id: 'transFat', label: 'Trans fat', key: 'transFatG', unit: 'g', targetMax: 0, kind: 'maximum', evidence: 'Editable goal' }
]);

export const CANONICAL_NUTRIENT_KEYS = Object.freeze(new Set([
  ...MACRO_NUTRIENTS.map(item => item.key),
  ...NUTRIENTS.map(item => item.key),
  ...SOURCE_NUTRIENTS.map(item => item.key)
]));

export const NUTRIENT_BY_ID = Object.freeze(Object.fromEntries(NUTRIENTS.map(item => [item.id, item])));

export const DEFAULT_STATE = Object.freeze({
  profile: {
    sexForBmr: 'female',
    age: 23,
    heightCm: 162.56,
    weightKg: 65.7708,
    activityMultiplier: 1.45,
    averageSteps: 5000,
    liftDaysPerWeek: 3,
    goal: 'fatLoss',
    pace: 'moderate'
  },
  targets: {
    autoCompute: true,
    computed: null,
    overrides: {}
  },
  settings: {
    units: 'imperial',
    usesSupplements: false,
    provider: 'gemini',
    geminiApiKey: '',
    geminiModel: 'gemini-3.8-flash',
    anthropicApiKey: '',
    foodDataCentralApiKey: '',
    cloudRepo: 'shreyavikram/longevity-diet-data',
    cloudToken: '',
    model: 'claude-sonnet-5',
    trainingDayToggleEnabled: true,
    weekStartsMonday: true,
    trackedNutrients: [...DEFAULT_TRACKED_NUTRIENTS],
    waterGlassMl: 250,
    waterBottleMl: 500,
    includeSecretsInExport: false
  },
  library: [],
  log: {},
  bodyMetrics: [],
  water: {},
  dayState: {},
  recommendations: [],
  meta: {
    schemaVersion: SCHEMA_VERSION,
    onboardingComplete: false,
    disclaimerAcknowledgedAt: null,
    migrations: []
  }
});
