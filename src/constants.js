export const SCHEMA_VERSION = 2;

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
  'saturatedFat', 'addedSugar'
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
  { id: 'fiber', label: 'Fiber', key: 'fiberG', unit: 'g', targetMin: 35, kind: 'minimum', evidence: 'Editable goal' },
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
  { id: 'sodium', label: 'Sodium', key: 'sodiumMg', group: 'micros', unit: 'mg', targetMax: 2300, kind: 'maximum', evidence: 'CDRR' },
  { id: 'saturatedFat', label: 'Saturated fat', key: 'saturatedFatG', unit: 'g', percentEnergyMax: 10, kind: 'maximum', evidence: 'Dietary guidance' },
  { id: 'addedSugar', label: 'Added sugar', key: 'addedSugarG', unit: 'g', percentEnergyMax: 10, kind: 'maximum', evidence: 'Dietary guidance' }
]);

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
    anthropicApiKey: '',
    foodDataCentralApiKey: '',
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
