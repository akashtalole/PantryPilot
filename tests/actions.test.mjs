import "./setup-localstorage.mjs";
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { store } from "../js/state-store.js";
import { Actions, ActionError, _resetUndoHistoryForTests } from "../js/actions.js";

beforeEach(() => {
  store.reset();
  _resetUndoHistoryForTests();
});

test("searchRecipes filters out recipes that conflict with dietary preferences by default", () => {
  Actions.setDietaryPreferences({ vegan: true }, "human");
  const results = Actions.searchRecipes({});
  assert.ok(results.every((r) => r.tags.includes("vegan")));
  assert.ok(results.length > 0, "expected at least one vegan recipe to remain");
});

test("searchRecipes can include conflicting recipes when respectDietary is false", () => {
  Actions.setDietaryPreferences({ vegan: true }, "human");
  const withDietary = Actions.searchRecipes({ respectDietary: true });
  const withoutDietary = Actions.searchRecipes({ respectDietary: false });
  assert.ok(withoutDietary.length > withDietary.length);
});

test("searchRecipes sortBy pantryMatch ranks fewest-missing-ingredients first", () => {
  const results = Actions.searchRecipes({ sortBy: "pantryMatch" });
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].pantryMatch.missing <= results[i].pantryMatch.missing);
  }
});

test("searchRecipes requires all given tags (AND, not OR)", () => {
  const results = Actions.searchRecipes({ tags: ["vegan", "quick"], respectDietary: false });
  assert.ok(results.every((r) => r.tags.includes("vegan") && r.tags.includes("quick")));
});

test("addRecipeToPlan rejects a dietary conflict unless forced", () => {
  Actions.setDietaryPreferences({ vegan: true }, "human");
  assert.throws(
    () => Actions.addRecipeToPlan({ day: "Mon", recipeId: "chicken-tacos" }, "agent"),
    ActionError
  );
  // Plan should remain untouched after the rejected attempt.
  const plan = Actions.getMealPlan();
  assert.equal(plan.days.find((d) => d.day === "Mon").recipe, null);

  const result = Actions.addRecipeToPlan({ day: "Mon", recipeId: "chicken-tacos", force: true }, "agent");
  assert.equal(result.day, "Mon");
  assert.equal(result.recipe, "Weeknight Chicken Tacos");
});

test("addRecipeToPlan rejects an unknown day or recipe id", () => {
  assert.throws(() => Actions.addRecipeToPlan({ day: "Someday", recipeId: "chickpea-curry" }), ActionError);
  assert.throws(() => Actions.addRecipeToPlan({ day: "Mon", recipeId: "not-a-real-recipe" }), ActionError);
});

test("getMealPlan totals scale with servings and sum correctly across the week", () => {
  Actions.addRecipeToPlan({ day: "Mon", recipeId: "chickpea-curry", servings: 8 }, "human"); // 2x normal servings
  Actions.addRecipeToPlan({ day: "Tue", recipeId: "veggie-omelette" }, "human");
  const plan = Actions.getMealPlan();
  const mon = plan.days.find((d) => d.day === "Mon").recipe;
  assert.equal(mon.estCost, Number((2.1 * 8).toFixed(2)));
  const tue = plan.days.find((d) => d.day === "Tue").recipe;
  assert.equal(tue.estCost, Number((1.8 * 2).toFixed(2)));
  assert.equal(plan.weekEstCost, Number((mon.estCost + tue.estCost).toFixed(2)));
});

test("generateShoppingList aggregates a shared ingredient across two recipes and excludes pantry-have items", () => {
  // chickpea-curry and tofu-curry both need coconut milk (1 can).
  Actions.addRecipeToPlan({ day: "Mon", recipeId: "chickpea-curry" }, "human");
  Actions.addRecipeToPlan({ day: "Tue", recipeId: "tofu-curry" }, "human");
  let { items } = Actions.getShoppingList();
  const coconutMilk = items.find((i) => i.name === "coconut milk" && i.unit === "can");
  assert.ok(coconutMilk, "expected coconut milk on the shopping list");
  assert.equal(coconutMilk.qty, 2);

  Actions.updatePantryItem({ name: "coconut milk", have: true }, "human");
  ({ items } = Actions.getShoppingList());
  assert.equal(items.find((i) => i.name === "coconut milk"), undefined, "pantry-have items should be excluded");
});

test("generateShoppingList preserves checked state for items still needed after a regen", () => {
  Actions.addRecipeToPlan({ day: "Mon", recipeId: "veggie-omelette" }, "human");
  const { items } = Actions.getShoppingList();
  const eggs = items.find((i) => i.name === "eggs");
  Actions.toggleShoppingItem({ name: "eggs", unit: eggs.unit, checked: true }, "human");

  // Regenerate by touching an unrelated pantry item.
  Actions.updatePantryItem({ name: "unrelated item", have: true }, "human");
  const { items: after } = Actions.getShoppingList();
  assert.equal(after.find((i) => i.name === "eggs").checked, true);
});

test("toggleShoppingItem throws for an item not currently on the list", () => {
  assert.throws(() => Actions.toggleShoppingItem({ name: "unobtainium", checked: true }), ActionError);
});

test("setWeeklyBudget rejects negative or non-numeric amounts, accepts null to clear", () => {
  assert.throws(() => Actions.setWeeklyBudget({ amount: -5 }), ActionError);
  assert.throws(() => Actions.setWeeklyBudget({ amount: "sixty" }), ActionError);
  Actions.setWeeklyBudget({ amount: 60 }, "human");
  assert.equal(Actions.getBudgetStatus().weeklyBudget, 60);
  Actions.setWeeklyBudget({ amount: null }, "human");
  assert.equal(Actions.getBudgetStatus().weeklyBudget, null);
});

test("getBudgetStatus reports remaining and overBudget correctly", () => {
  Actions.setWeeklyBudget({ amount: 10 }, "human");
  Actions.addRecipeToPlan({ day: "Mon", recipeId: "lentil-soup" }, "human");
  const status = Actions.getBudgetStatus();
  assert.equal(status.overBudget, false);
  assert.ok(status.remaining > 0);

  Actions.setWeeklyBudget({ amount: 1 }, "human");
  const overStatus = Actions.getBudgetStatus();
  assert.equal(overStatus.overBudget, true);
  assert.ok(overStatus.remaining < 0);
});

test("planWeek only fills empty days by default and avoids repeating a recipe", () => {
  Actions.addRecipeToPlan({ day: "Mon", recipeId: "chickpea-curry" }, "human");
  const result = Actions.planWeek({}, "agent");
  assert.equal(result.planned.find((p) => p.day === "Mon"), undefined, "Mon was already planned and should be skipped");
  assert.equal(result.skipped.find((s) => s.day === "Mon").reason, "already planned");

  const plannedIds = result.plan.days.map((d) => d.recipe?.id).filter(Boolean);
  const uniqueIds = new Set(plannedIds);
  assert.equal(plannedIds.length, uniqueIds.size, "planWeek should not repeat a recipe across the week");
});

test("planWeek never overrides an active dietary conflict, even without force", () => {
  Actions.setDietaryPreferences({ vegan: true }, "human");
  const result = Actions.planWeek({}, "agent");
  for (const day of result.plan.days) {
    if (!day.recipe) continue;
    const conflicts = Actions.getRecipe({ recipeId: day.recipe.id }).dietaryConflicts;
    assert.deepEqual(conflicts, []);
  }
});

test("planWeek respects a tight weekly budget by skipping days it can't afford", () => {
  Actions.setWeeklyBudget({ amount: 5 }, "human"); // smaller than most single recipes' full-batch cost
  const result = Actions.planWeek({ days: ["Mon", "Tue"] }, "agent");
  const finalStatus = Actions.getBudgetStatus();
  assert.ok(finalStatus.weekEstCost <= 5.01, `week cost ${finalStatus.weekEstCost} should not exceed the $5 budget`);
  assert.ok(result.planned.length + result.skipped.length === 2);
});

test("updatePantryItem normalizes whitespace and casing in item names", () => {
  Actions.updatePantryItem({ name: "  Quinoa  ", have: true }, "human");
  const pantry = Actions.getPantry();
  assert.ok(pantry.find((p) => p.name === "quinoa" && p.have === true));
});

test("getRecentActivity tags every action with the correct actor", () => {
  Actions.addRecipeToPlan({ day: "Mon", recipeId: "chickpea-curry" }, "human");
  Actions.addRecipeToPlan({ day: "Tue", recipeId: "lentil-soup" }, "agent");
  const log = Actions.getRecentActivity({ limit: 5 });
  assert.equal(log[0].actor, "agent"); // most recent first
  assert.equal(log[1].actor, "human");
});

// ---------------------------------------------------------------------------
// Nutrition

test("searchRecipes filters by maxCaloriesPerServing and minProteinPerServing", () => {
  const lowCal = Actions.searchRecipes({ maxCaloriesPerServing: 350, respectDietary: false });
  assert.ok(lowCal.every((r) => r.nutrition.calories <= 350));
  assert.ok(lowCal.length > 0);

  const highProtein = Actions.searchRecipes({ minProteinPerServing: 25, respectDietary: false });
  assert.ok(highProtein.every((r) => r.nutrition.proteinG >= 25));
  assert.ok(highProtein.length > 0);
});

test("searchRecipes sortBy calories orders ascending", () => {
  const results = Actions.searchRecipes({ sortBy: "calories", respectDietary: false });
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].nutrition.calories <= results[i].nutrition.calories);
  }
});

test("getWeekNutritionSummary totals and averages only count planned days", () => {
  Actions.addRecipeToPlan({ day: "Mon", recipeId: "veggie-omelette" }, "human"); // 320 kcal
  Actions.addRecipeToPlan({ day: "Tue", recipeId: "lentil-soup" }, "human"); // 260 kcal
  const summary = Actions.getWeekNutritionSummary();
  assert.equal(summary.plannedDayCount, 2);
  assert.equal(summary.totals.calories, 320 + 260);
  assert.equal(summary.avgPerPlannedDay.calories, Math.round((320 + 260) / 2));
  assert.equal(summary.days.find((d) => d.day === "Wed").nutrition, null);
});

test("getWeekNutritionSummary reports null averages with an empty plan", () => {
  const summary = Actions.getWeekNutritionSummary();
  assert.equal(summary.plannedDayCount, 0);
  assert.equal(summary.avgPerPlannedDay, null);
});

// ---------------------------------------------------------------------------
// Expiry-aware pantry

function daysFromNow(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test("updatePantryItem sets and clears expiresOn independently of have", () => {
  Actions.updatePantryItem({ name: "milk", have: true, expiresOn: daysFromNow(2) }, "human");
  let item = Actions.getPantry().find((p) => p.name === "milk");
  assert.equal(item.have, true);
  assert.ok(item.daysUntilExpiry <= 2 && item.daysUntilExpiry >= 1);

  // Updating `have` alone should not touch the stored expiry date.
  Actions.updatePantryItem({ name: "milk", have: false }, "human");
  item = Actions.getPantry().find((p) => p.name === "milk");
  assert.equal(item.have, false);
  assert.equal(item.expiresOn, daysFromNow(2));

  // Explicitly clearing it should work.
  Actions.updatePantryItem({ name: "milk", expiresOn: null }, "human");
  item = Actions.getPantry().find((p) => p.name === "milk");
  assert.equal(item.expiresOn, null);
});

test("updatePantryItem rejects a malformed expiresOn value", () => {
  assert.throws(() => Actions.updatePantryItem({ name: "milk", expiresOn: "not-a-date" }), ActionError);
});

test("getExpiringSoon only returns in-stock items within the window, soonest first", () => {
  Actions.updatePantryItem({ name: "milk", have: true, expiresOn: daysFromNow(1) }, "human");
  Actions.updatePantryItem({ name: "yogurt", have: true, expiresOn: daysFromNow(2) }, "human");
  Actions.updatePantryItem({ name: "flour", have: true, expiresOn: daysFromNow(30) }, "human"); // outside window
  Actions.updatePantryItem({ name: "spinach", have: false, expiresOn: daysFromNow(1) }, "human"); // not on hand

  const soon = Actions.getExpiringSoon({ withinDays: 3 });
  const names = soon.map((i) => i.name);
  assert.deepEqual(names, ["milk", "yogurt"]);
});

test("searchRecipes sortBy expiringSoon ranks recipes using soon-to-expire pantry items first", () => {
  // veggie-omelette uses eggs, bell pepper, spinach, cheddar cheese, onion.
  Actions.updatePantryItem({ name: "eggs", have: true, expiresOn: daysFromNow(1) }, "human");
  Actions.updatePantryItem({ name: "spinach", have: true, expiresOn: daysFromNow(1) }, "human");
  const results = Actions.searchRecipes({ sortBy: "expiringSoon", respectDietary: false });
  assert.equal(results[0].id, "veggie-omelette");
  assert.equal(results[0].usesExpiringSoon, 2);
});

test("planWeek prioritizeExpiring prefers a recipe that uses an expiring pantry item", () => {
  Actions.updatePantryItem({ name: "eggs", have: true, expiresOn: daysFromNow(1) }, "human");
  Actions.updatePantryItem({ name: "spinach", have: true, expiresOn: daysFromNow(1) }, "human");
  const result = Actions.planWeek({ days: ["Mon"], prioritizeExpiring: true }, "agent");
  assert.equal(result.planned[0].recipe, "Veggie Omelette");
});

// ---------------------------------------------------------------------------
// Undo

test("undoLastAction throws when there is nothing to undo", () => {
  assert.throws(() => Actions.undoLastAction(), ActionError);
});

test("canUndo reflects the stack without mutating it", () => {
  assert.equal(Actions.canUndo().canUndo, false);
  Actions.addRecipeToPlan({ day: "Mon", recipeId: "chickpea-curry" }, "human");
  const preview = Actions.canUndo();
  assert.equal(preview.canUndo, true);
  assert.match(preview.description, /chickpea curry/i);
  // Calling canUndo again shouldn't consume the entry.
  assert.deepEqual(Actions.canUndo(), preview);
});

test("undoLastAction reverts addRecipeToPlan, including its cascaded shopping-list update", () => {
  Actions.addRecipeToPlan({ day: "Mon", recipeId: "chickpea-curry" }, "human");
  assert.ok(Actions.getShoppingList().items.length > 0);

  Actions.undoLastAction("human");

  const plan = Actions.getMealPlan();
  assert.equal(plan.days.find((d) => d.day === "Mon").recipe, null);
  assert.equal(Actions.getShoppingList().items.length, 0);
});

test("a single addRecipeToPlan call only produces one undo step, despite cascading internal updates", () => {
  Actions.addRecipeToPlan({ day: "Mon", recipeId: "chickpea-curry" }, "human");
  Actions.undoLastAction("human");
  // If the cascaded (silent) shopping-list regen had also pushed an undo
  // entry, this second undo would revert something else instead of failing.
  assert.throws(() => Actions.undoLastAction(), ActionError);
});

test("sequential undos walk back through multiple actions in order", () => {
  Actions.addRecipeToPlan({ day: "Mon", recipeId: "chickpea-curry" }, "human");
  Actions.addRecipeToPlan({ day: "Tue", recipeId: "lentil-soup" }, "human");

  Actions.undoLastAction("human"); // undoes Tue
  let plan = Actions.getMealPlan();
  assert.equal(plan.days.find((d) => d.day === "Tue").recipe, null);
  assert.equal(plan.days.find((d) => d.day === "Mon").recipe.id, "chickpea-curry");

  Actions.undoLastAction("human"); // undoes Mon
  plan = Actions.getMealPlan();
  assert.equal(plan.days.find((d) => d.day === "Mon").recipe, null);
});

test("undoLastAction reverts a pantry update", () => {
  Actions.updatePantryItem({ name: "quinoa", have: true }, "human");
  assert.equal(Actions.getPantry().find((p) => p.name === "quinoa").have, true);
  Actions.undoLastAction("human");
  assert.equal(Actions.getPantry().find((p) => p.name === "quinoa"), undefined);
});
