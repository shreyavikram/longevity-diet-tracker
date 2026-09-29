// A small offline glycemic index (GI) reference, glucose = 100. Values are the means (± SEM) reported in the
// International Tables of Glycemic Index and Glycemic Load Values: 2008 (Atkinson, Foster-Powell and
// Brand-Miller, Diabetes Care 2008;31:2281-2283). Each range is the mean ± 2 SEM, a rough interval for the
// average response; individual responses vary more. Values are facts cited from the paper, not a copied database.
const TABLES_2008 = 'https://doi.org/10.2337/dc08-1239';
const SOURCE = 'International GI tables 2008';

const entry = (name, matchTerms, preparations, value, sem) => Object.freeze({
  name,
  matchTerms: Object.freeze(matchTerms),
  preparations: Object.freeze(preparations),
  value,
  range: Object.freeze({ min: Math.max(0, value - 2 * sem), max: value + 2 * sem }),
  sourceName: SOURCE,
  sourceUrl: TABLES_2008
});

export const GI_REFERENCE = Object.freeze([
  // Grains and breads
  entry('white wheat bread', ['white bread', 'white wheat bread'], ['commercial loaf'], 75, 2),
  entry('whole wheat bread', ['whole wheat bread', 'wholemeal bread', 'whole grain bread'], ['commercial loaf'], 74, 2),
  entry('wheat roti', ['roti'], ['cooked'], 62, 3),
  entry('chapatti', ['chapatti', 'chapati'], ['cooked'], 52, 4),
  entry('corn tortilla', ['corn tortilla'], ['cooked'], 46, 4),
  entry('white rice', ['white rice', 'jasmine rice'], ['boiled', 'cooked', 'steamed'], 73, 4),
  entry('brown rice', ['brown rice'], ['boiled', 'cooked', 'steamed'], 68, 4),
  entry('barley', ['barley', 'pearl barley'], ['boiled', 'cooked'], 28, 2),
  entry('sweet corn', ['sweet corn', 'corn kernel'], ['boiled', 'cooked'], 52, 5),
  entry('white spaghetti', ['spaghetti', 'pasta'], ['boiled', 'cooked'], 49, 2),
  entry('whole wheat spaghetti', ['whole wheat spaghetti', 'whole wheat pasta', 'wholemeal pasta'], ['boiled', 'cooked'], 48, 5),
  entry('rice noodles', ['rice noodle'], ['boiled', 'cooked'], 53, 7),
  entry('udon noodles', ['udon'], ['boiled', 'cooked'], 55, 7),
  entry('couscous', ['couscous'], ['boiled', 'cooked'], 65, 4),
  // Breakfast cereals
  entry('cornflakes', ['cornflake', 'corn flake'], ['dry cereal'], 81, 6),
  entry('rolled oat porridge', ['rolled oat', 'oatmeal', 'oat porridge', 'old fashioned oat', 'oat'], ['porridge', 'cooked', 'boiled'], 55, 2),
  entry('instant oat porridge', ['instant oat', 'instant oatmeal', 'quick oat'], ['porridge', 'cooked'], 79, 3),
  entry('rice porridge', ['rice porridge', 'congee'], ['cooked'], 78, 9),
  entry('millet porridge', ['millet'], ['porridge', 'cooked'], 67, 5),
  entry('muesli', ['muesli'], ['dry cereal'], 57, 2),
  // Fruit
  entry('apple', ['apple'], ['raw'], 36, 2),
  entry('orange', ['orange'], ['raw'], 43, 3),
  entry('banana', ['banana'], ['raw'], 51, 3),
  entry('pineapple', ['pineapple'], ['raw'], 59, 8),
  entry('mango', ['mango'], ['raw'], 51, 5),
  entry('watermelon', ['watermelon'], ['raw'], 76, 4),
  entry('dates', ['date', 'medjool date'], ['raw', 'dried'], 42, 4),
  entry('apple juice', ['apple juice'], ['juice'], 41, 2),
  entry('orange juice', ['orange juice'], ['juice'], 50, 2),
  // Vegetables
  entry('potato', ['potato'], ['boiled'], 78, 4),
  entry('instant mashed potato', ['instant mashed potato', 'instant potato'], ['prepared'], 87, 3),
  entry('french fries', ['french fries', 'potato fries'], ['fried', 'baked'], 63, 5),
  entry('carrots', ['carrot'], ['boiled', 'cooked'], 39, 4),
  entry('sweet potato', ['sweet potato'], ['boiled', 'cooked'], 63, 6),
  entry('pumpkin', ['pumpkin'], ['boiled', 'cooked'], 64, 7),
  entry('plantain', ['plantain', 'green banana'], ['boiled', 'cooked'], 55, 6),
  entry('taro', ['taro'], ['boiled', 'cooked'], 53, 2),
  // Milk and alternatives
  entry('soy milk', ['soy milk', 'soymilk', 'soya milk'], ['drink'], 34, 4),
  entry('rice milk', ['rice milk'], ['drink'], 86, 7),
  entry('full-fat milk', ['whole milk', 'full fat milk', 'dairy milk', 'cow milk'], ['drink'], 39, 3),
  // Legumes
  entry('chickpeas', ['chickpea', 'garbanzo bean'], ['boiled', 'canned', 'cooked'], 28, 9),
  entry('kidney beans', ['kidney bean'], ['boiled', 'cooked', 'canned'], 24, 4),
  entry('lentils', ['lentil', 'dal', 'dhal'], ['boiled', 'cooked'], 32, 5),
  entry('soya beans', ['soybean', 'soya bean', 'edamame'], ['boiled', 'cooked'], 16, 1),
  // Snacks and sugars
  entry('popcorn', ['popcorn'], ['popped'], 65, 5),
  entry('potato crisps', ['potato chip', 'potato crisp'], ['fried'], 56, 3),
  entry('rice crackers', ['rice cracker', 'rice cake', 'rice crisp'], ['dry'], 87, 2),
  entry('chocolate', ['chocolate'], ['solid'], 40, 3),
  entry('soft drink', ['soda', 'soft drink', 'cola'], ['drink'], 59, 3),
  entry('honey', ['honey'], ['plain'], 61, 3),
  entry('table sugar', ['sucrose', 'table sugar'], ['plain'], 65, 4),
  entry('glucose', ['glucose'], ['reference'], 103, 3)
]);
