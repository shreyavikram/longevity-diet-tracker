// Drinks count toward the day's water (her request, 2026-10-01): she drinks plant milk in place of water. Only
// drinks count; milk cooked into oatmeal or poured on cereal does not, nor does the moisture in food. The amount
// comes from the analysis estimate's liquid ingredients, at 1 g to 1 ml, per serving.

const DRINK = /milk|coffee|latte|cappuccino|espresso|americano|mocha|\btea\b|matcha|\bchai\b|cocoa|hot chocolate|smoothie|shake|juice|kombucha|lemonade|\bsoda\b|\bdrink|beverage|kefir/i;
const FOOD = /\b(?:oatmeal|oats|porridge|cereal|granola|muesli|bowl|pudding|soup|stew|curry|yog(?:h)?urt|pancakes?|waffles?|bread|toast|sauce|cake|muffins?|cookies?|bake|pasta|rice|tofu|scramble|ice cream|overnight)\b/i;
const LIQUID = /milk|coffee|espresso|cold brew|\btea\b|\bchai\b|juice|kombucha|coconut water|\bsoda\b|lemonade|kefir/i;
const NOT_LIQUID = /powder|dried|freeze|instant|granule|ground|\bbeans?\b|lea(?:f|ves)|\bbags?\b|syrup|creamer|chocolate|condensed|evaporated|cheese|yog(?:h)?urt/i;

const grams = value => Number.isFinite(value) && value > 0 ? value : 0;

export function isDrinkName(name) {
  const text = String(name ?? '');
  return DRINK.test(text) && !FOOD.test(text);
}

// Milliliters per serving that an analysis estimate's drink adds to water, or null when it is not a drink or no
// liquid amount is known.
export function drinkFluidMl(estimate) {
  if (!estimate || !isDrinkName(estimate.name)) return null;
  // A known product (a Huel bottle, Silk by the cup) carries its own amount; other parts count by name.
  const liquid = (estimate.components ?? []).reduce((sum, component) => sum + (Number.isFinite(component.productFluidMl)
    ? grams(component.productFluidMl)
    : LIQUID.test(component.name ?? '') && !NOT_LIQUID.test(component.name ?? '') ? grams(component.estimatedGrams) : 0), 0)
    + grams(estimate.plainWaterG);
  if (!liquid) return null;
  const servings = Number.isFinite(estimate.totalServings) && estimate.totalServings > 0 ? estimate.totalServings : 1;
  return Math.round(liquid / servings / 10) * 10;
}

// Per serving: the entry's own amount when set (0 leaves it out), else the rule applied to its saved analysis.
export function entryFluidMl(entry) {
  if (!entry || entry.type === 'supplement') return 0;
  if (Number.isFinite(entry.fluidMl)) return Math.max(0, entry.fluidMl);
  return drinkFluidMl(entry.analysis?.estimate) ?? 0;
}
