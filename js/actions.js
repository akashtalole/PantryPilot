// Shared domain logic. This is the single source of truth for every mutation
// in the app. Both the human UI (js/ui.js) and the WebMCP tools
// (js/webmcp-tools.js) call these same functions with an `actor` tag
// ("human" | "agent"), so state can never drift between the two surfaces and
// the activity log shows a true record of who did what.
import { store, DAYS } from "./state-store.js";
import { RECIPES, findRecipeById } from "./recipes-data.js";

const DIET_FLAG_TO_TAG = {
  vegetarian: "vegetarian",
  vegan: "vegan",
  glutenFree: "glutenFree",
  dairyFree: "dairyFree",
  nutFree: "nutFree",
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_DEFAULT_DAYS = 3;
const UNDO_STACK_MAX = 10;

class ActionError extends Error {}

function log(actor, message) {
  store.update((s) => {
    s.log.unshift({ ts: Date.now(), actor, message });
    s.log = s.log.slice(0, 50);
  });
}

// ---------------------------------------------------------------------------
// Undo: a snapshot-based history so a careless agent (or human) action can be
// reverted. Every action that actually mutates plan/pantry/dietary/budget/
// shopping state pushes a deep clone of state *just before* it changes onto
// this stack, right before its own store.update call -- never at function
// entry -- so a rejected/no-op call (e.g. an unknown recipe id) never
// pollutes the undo history. Kept as in-memory module state (not persisted)
// since it's meant for "undo what just happened this session," not a
// permanent audit trail -- that's what the activity log is for.
let undoStack = [];

function snapshotForUndo(description, actor) {
  undoStack.push({ description, actor, snapshot: JSON.parse(JSON.stringify(store.getState())) });
  if (undoStack.length > UNDO_STACK_MAX) undoStack.shift();
}

/** Test-only: clears in-memory undo history so tests don't leak state into each other. */
export function _resetUndoHistoryForTests() {
  undoStack = [];
}

function currentDietary() {
  return store.getState().dietary;
}

/** Returns a list of human-readable reasons a recipe conflicts with active dietary preferences. */
function dietaryConflicts(recipe) {
  const dietary = currentDietary();
  const reasons = [];
  for (const [flag, tag] of Object.entries(DIET_FLAG_TO_TAG)) {
    if (dietary[flag] && !recipe.tags.includes(tag)) {
      reasons.push(`not ${tag === "glutenFree" ? "gluten-free" : tag === "dairyFree" ? "dairy-free" : tag === "nutFree" ? "nut-free" : tag}`);
    }
  }
  const avoid = (dietary.avoidIngredients || []).map((i) => i.toLowerCase());
  if (avoid.length) {
    const hit = recipe.ingredients.find((ing) => avoid.some((a) => ing.name.toLowerCase().includes(a)));
    if (hit) reasons.push(`contains avoided ingredient "${hit.name}"`);
  }
  return reasons;
}

/** Ingredients a recipe needs that aren't already marked "have" in the pantry. */
function missingIngredients(recipe) {
  const pantry = store.getState().pantry;
  return recipe.ingredients.filter((ing) => {
    const entry = pantry[ing.name.toLowerCase()];
    return !(entry && entry.have);
  });
}

function daysUntil(dateStr) {
  return Math.ceil((Date.parse(dateStr) - Date.now()) / MS_PER_DAY);
}

/** Lowercased names of pantry items on hand that expire within `withinDays` (including already-expired). */
function expiringSoonNames(withinDays = EXPIRING_SOON_DEFAULT_DAYS) {
  const pantry = store.getState().pantry;
  const names = new Set();
  for (const [name, entry] of Object.entries(pantry)) {
    if (!entry.have || !entry.expiresOn) continue;
    if (daysUntil(entry.expiresOn) <= withinDays) names.add(name);
  }
  return names;
}

function recipeSummary(recipe) {
  const missing = missingIngredients(recipe);
  const expiringSoon = expiringSoonNames();
  const usesExpiringSoon = recipe.ingredients.filter((ing) => expiringSoon.has(ing.name.toLowerCase())).length;
  return {
    id: recipe.id,
    name: recipe.name,
    tags: recipe.tags,
    prepMinutes: recipe.prepMinutes,
    servings: recipe.servings,
    costPerServing: recipe.costPerServing,
    nutrition: recipe.nutrition,
    dietaryConflicts: dietaryConflicts(recipe),
    pantryMatch: { missing: missing.length, total: recipe.ingredients.length },
    usesExpiringSoon,
  };
}

const SORTERS = {
  pantryMatch: (a, b) => a.pantryMatch.missing - b.pantryMatch.missing,
  cost: (a, b) => a.costPerServing - b.costPerServing,
  prepTime: (a, b) => a.prepMinutes - b.prepMinutes,
  calories: (a, b) => a.nutrition.calories - b.nutrition.calories,
  expiringSoon: (a, b) => b.usesExpiringSoon - a.usesExpiringSoon,
};

export const Actions = {
  searchRecipes({
    query,
    tags,
    maxPrepMinutes,
    respectDietary = true,
    sortBy = "relevance",
    maxCaloriesPerServing,
    minProteinPerServing,
  } = {}) {
    const q = (query || "").trim().toLowerCase();
    let results = RECIPES.filter((r) => {
      if (q) {
        const inName = r.name.toLowerCase().includes(q);
        const inIngredient = r.ingredients.some((i) => i.name.toLowerCase().includes(q));
        if (!inName && !inIngredient) return false;
      }
      if (tags && tags.length && !tags.every((t) => r.tags.includes(t))) return false;
      if (maxPrepMinutes && r.prepMinutes > maxPrepMinutes) return false;
      if (maxCaloriesPerServing && r.nutrition.calories > maxCaloriesPerServing) return false;
      if (minProteinPerServing && r.nutrition.proteinG < minProteinPerServing) return false;
      if (respectDietary && dietaryConflicts(r).length) return false;
      return true;
    }).map(recipeSummary);
    if (SORTERS[sortBy]) results = [...results].sort(SORTERS[sortBy]);
    return results;
  },

  getRecipe({ recipeId }) {
    const recipe = findRecipeById(recipeId);
    if (!recipe) throw new ActionError(`No recipe found with id "${recipeId}".`);
    return { ...recipe, dietaryConflicts: dietaryConflicts(recipe) };
  },

  listAllRecipes() {
    return RECIPES.map(recipeSummary);
  },

  getDietaryPreferences() {
    return { ...currentDietary() };
  },

  setDietaryPreferences(prefs = {}, actor = "human") {
    const allowedFlags = Object.keys(DIET_FLAG_TO_TAG);
    snapshotForUndo("update dietary preferences", actor);
    store.update((s) => {
      for (const flag of allowedFlags) {
        if (typeof prefs[flag] === "boolean") s.dietary[flag] = prefs[flag];
      }
      if (Array.isArray(prefs.avoidIngredients)) {
        s.dietary.avoidIngredients = prefs.avoidIngredients.map(String);
      }
    });
    log(actor, `updated dietary preferences`);
    Actions.generateShoppingList(actor, { silent: true });
    return Actions.getDietaryPreferences();
  },

  getMealPlan() {
    const state = store.getState();
    let totalCost = 0;
    const days = DAYS.map((day) => {
      const entry = state.plan[day];
      if (!entry) return { day, recipe: null };
      const recipe = findRecipeById(entry.recipeId);
      if (!recipe) return { day, recipe: null };
      const servings = entry.servings || recipe.servings;
      const cost = recipe.costPerServing * servings;
      totalCost += cost;
      return {
        day,
        recipe: { id: recipe.id, name: recipe.name, servings, estCost: Number(cost.toFixed(2)) },
      };
    });
    return { days, weekEstCost: Number(totalCost.toFixed(2)) };
  },

  /** Per-serving nutrition for each planned day plus weekly totals/averages -- "how many calories/day is this plan averaging". */
  getWeekNutritionSummary() {
    const state = store.getState();
    const days = DAYS.map((day) => {
      const entry = state.plan[day];
      const recipe = entry && findRecipeById(entry.recipeId);
      return { day, recipe: recipe ? recipe.name : null, nutrition: recipe ? recipe.nutrition : null };
    });
    const planned = days.filter((d) => d.nutrition);
    const sum = (key) => planned.reduce((total, d) => total + d.nutrition[key], 0);
    const totals = { calories: sum("calories"), proteinG: sum("proteinG"), carbsG: sum("carbsG"), fatG: sum("fatG") };
    const avgPerPlannedDay = planned.length
      ? {
          calories: Math.round(totals.calories / planned.length),
          proteinG: Math.round(totals.proteinG / planned.length),
          carbsG: Math.round(totals.carbsG / planned.length),
          fatG: Math.round(totals.fatG / planned.length),
        }
      : null;
    return { days, plannedDayCount: planned.length, totals, avgPerPlannedDay };
  },

  addRecipeToPlan({ day, recipeId, servings, force = false }, actor = "human") {
    if (!DAYS.includes(day)) {
      throw new ActionError(`"${day}" is not a valid day. Use one of: ${DAYS.join(", ")}.`);
    }
    const recipe = findRecipeById(recipeId);
    if (!recipe) throw new ActionError(`No recipe found with id "${recipeId}".`);
    const conflicts = dietaryConflicts(recipe);
    if (conflicts.length && !force) {
      throw new ActionError(
        `"${recipe.name}" conflicts with active dietary preferences (${conflicts.join(", ")}). ` +
          `Pass force: true to add it anyway, or choose another recipe.`
      );
    }
    const finalServings = servings && servings > 0 ? servings : recipe.servings;
    snapshotForUndo(`add "${recipe.name}" to ${day}`, actor);
    store.update((s) => {
      s.plan[day] = { recipeId, servings: finalServings };
    });
    log(actor, `planned "${recipe.name}" for ${day}${conflicts.length ? " (dietary override)" : ""}`);
    Actions.generateShoppingList(actor, { silent: true });
    return { day, recipe: recipe.name, servings: finalServings, plan: Actions.getMealPlan() };
  },

  removeRecipeFromPlan({ day }, actor = "human") {
    if (!DAYS.includes(day)) {
      throw new ActionError(`"${day}" is not a valid day. Use one of: ${DAYS.join(", ")}.`);
    }
    const existing = store.getState().plan[day];
    const removedName = existing ? findRecipeById(existing.recipeId)?.name : null;
    snapshotForUndo(`clear ${day}${removedName ? ` (was "${removedName}")` : ""}`, actor);
    store.update((s) => {
      s.plan[day] = null;
    });
    log(actor, `cleared ${day}${removedName ? ` (was "${removedName}")` : ""}`);
    Actions.generateShoppingList(actor, { silent: true });
    return { day, plan: Actions.getMealPlan() };
  },

  getBudgetStatus() {
    const state = store.getState();
    const { weekEstCost } = Actions.getMealPlan();
    const weeklyBudget = state.weeklyBudget;
    return {
      weeklyBudget,
      weekEstCost,
      remaining: weeklyBudget == null ? null : Number((weeklyBudget - weekEstCost).toFixed(2)),
      overBudget: weeklyBudget != null && weekEstCost > weeklyBudget,
    };
  },

  setWeeklyBudget({ amount }, actor = "human") {
    if (amount !== null && (typeof amount !== "number" || amount < 0 || Number.isNaN(amount))) {
      throw new ActionError("amount must be a non-negative number, or null to clear the budget.");
    }
    snapshotForUndo(amount == null ? "clear weekly budget" : `set weekly budget to $${amount.toFixed(2)}`, actor);
    store.update((s) => {
      s.weeklyBudget = amount;
    });
    log(actor, amount == null ? "cleared the weekly budget" : `set weekly budget to $${amount.toFixed(2)}`);
    return Actions.getBudgetStatus();
  },

  /**
   * Fills in the meal plan automatically under a set of constraints, instead
   * of requiring one add-recipe-to-plan call per day. Always respects active
   * dietary preferences (never overrides them) and, unless told otherwise,
   * skips days that already have a recipe and avoids repeating a recipe
   * already used elsewhere in the week. Candidates are ranked by how many
   * ingredients are already in the pantry, then by cost, then by prep time.
   */
  planWeek(
    {
      days,
      tags,
      maxPrepMinutes,
      avoidRepeats = true,
      onlyEmptyDays = true,
      respectBudget = true,
      maxCaloriesPerServing,
      minProteinPerServing,
      prioritizeExpiring = false,
    } = {},
    actor = "agent"
  ) {
    const targetDays = (days && days.length ? days : DAYS).filter((d) => DAYS.includes(d));
    if (!targetDays.length) throw new ActionError(`No valid days given. Use one or more of: ${DAYS.join(", ")}.`);

    const state = store.getState();
    const usedRecipeIds = new Set(
      avoidRepeats ? Object.values(state.plan).filter(Boolean).map((e) => e.recipeId) : []
    );
    const weeklyBudget = state.weeklyBudget;
    let runningCost = Actions.getMealPlan().weekEstCost;

    const planned = [];
    const skipped = [];
    const newPlanEntries = {};

    for (const day of targetDays) {
      if (onlyEmptyDays && state.plan[day]) {
        skipped.push({ day, reason: "already planned" });
        continue;
      }
      let candidates = Actions.searchRecipes({
        tags,
        maxPrepMinutes,
        maxCaloriesPerServing,
        minProteinPerServing,
        respectDietary: true,
        sortBy: prioritizeExpiring ? "expiringSoon" : "pantryMatch",
      });
      if (avoidRepeats) candidates = candidates.filter((r) => !usedRecipeIds.has(r.id));
      if (!candidates.length) {
        skipped.push({ day, reason: "no recipe matches the given filters and dietary preferences" });
        continue;
      }
      let chosen = null;
      if (respectBudget && weeklyBudget != null) {
        chosen = candidates.find((r) => runningCost + r.costPerServing * r.servings <= weeklyBudget);
        if (!chosen) {
          skipped.push({ day, reason: "no eligible recipe fits the remaining weekly budget" });
          continue;
        }
      } else {
        chosen = candidates[0];
      }
      const recipe = findRecipeById(chosen.id);
      newPlanEntries[day] = { recipeId: recipe.id, servings: recipe.servings };
      usedRecipeIds.add(recipe.id);
      runningCost += recipe.costPerServing * recipe.servings;
      planned.push({ day, recipe: recipe.name, estCost: Number((recipe.costPerServing * recipe.servings).toFixed(2)) });
    }

    if (planned.length) {
      snapshotForUndo(`auto-plan ${planned.length} day(s)`, actor);
      store.update((s) => {
        Object.assign(s.plan, newPlanEntries);
      });
      log(actor, `auto-planned ${planned.length} day(s): ${planned.map((p) => `${p.day} → ${p.recipe}`).join(", ")}`);
      Actions.generateShoppingList(actor, { silent: true });
    }

    return { planned, skipped, plan: Actions.getMealPlan(), budget: Actions.getBudgetStatus() };
  },

  getPantry() {
    const pantry = store.getState().pantry;
    return Object.entries(pantry)
      .map(([name, v]) => ({
        name,
        have: !!v.have,
        expiresOn: v.expiresOn ?? null,
        daysUntilExpiry: v.have && v.expiresOn ? daysUntil(v.expiresOn) : null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  /** Pantry items on hand that expire within `withinDays` (default 3), soonest first. Negative values mean already expired. */
  getExpiringSoon({ withinDays = EXPIRING_SOON_DEFAULT_DAYS } = {}) {
    return Actions.getPantry()
      .filter((item) => item.have && item.expiresOn != null && item.daysUntilExpiry <= withinDays)
      .sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
  },

  updatePantryItem({ name, have, expiresOn }, actor = "human") {
    if (!name || typeof name !== "string") throw new ActionError("Pantry item name is required.");
    if (expiresOn !== undefined && expiresOn !== null) {
      if (typeof expiresOn !== "string" || Number.isNaN(Date.parse(expiresOn))) {
        throw new ActionError('expiresOn must be an ISO date string (e.g. "2026-09-05") or null to clear it.');
      }
    }
    const clean = name.trim().toLowerCase();
    snapshotForUndo(`update pantry item "${clean}"`, actor);
    store.update((s) => {
      const existing = s.pantry[clean] || {};
      s.pantry[clean] = {
        have: have !== undefined ? !!have : !!existing.have,
        expiresOn: expiresOn !== undefined ? expiresOn : existing.expiresOn ?? null,
      };
    });
    log(actor, `updated pantry item "${clean}"${have !== undefined ? ` (${have ? "have" : "need"})` : ""}`);
    Actions.generateShoppingList(actor, { silent: true });
    return { name: clean, ...store.getState().pantry[clean] };
  },

  generateShoppingList(actor = "system", { silent = false } = {}) {
    const state = store.getState();
    const needed = new Map(); // key `${name}|${unit}` -> {name, unit, qty}
    for (const day of DAYS) {
      const entry = state.plan[day];
      if (!entry) continue;
      const recipe = findRecipeById(entry.recipeId);
      if (!recipe) continue;
      const scale = (entry.servings || recipe.servings) / recipe.servings;
      for (const ing of recipe.ingredients) {
        const pantryEntry = state.pantry[ing.name.toLowerCase()];
        if (pantryEntry && pantryEntry.have) continue; // already stocked, skip
        const key = `${ing.name}|${ing.unit}`;
        const scaledQty = Math.round(ing.qty * scale * 100) / 100;
        if (needed.has(key)) {
          needed.get(key).qty += scaledQty;
        } else {
          needed.set(key, { name: ing.name, unit: ing.unit, qty: scaledQty });
        }
      }
    }
    // Preserve checked state for items still needed.
    const prevChecked = new Map(state.shoppingList.map((i) => [`${i.name}|${i.unit}`, i.checked]));
    const list = [...needed.values()]
      .map((i) => ({ ...i, qty: Math.round(i.qty * 100) / 100, checked: prevChecked.get(`${i.name}|${i.unit}`) || false }))
      .sort((a, b) => a.name.localeCompare(b.name));

    let totalCost = 0;
    for (const day of DAYS) {
      const entry = state.plan[day];
      if (!entry) continue;
      const recipe = findRecipeById(entry.recipeId);
      if (!recipe) continue;
      totalCost += recipe.costPerServing * (entry.servings || recipe.servings);
    }

    if (!silent) snapshotForUndo("regenerate shopping list", actor);
    store.update((s) => {
      s.shoppingList = list;
    });
    if (!silent) log(actor, "regenerated shopping list");
    return { items: list, itemCount: list.length, weekEstCost: Number(totalCost.toFixed(2)) };
  },

  toggleShoppingItem({ name, unit, checked }, actor = "human") {
    const existing = store.getState().shoppingList.find((i) => i.name === name && (unit ? i.unit === unit : true));
    if (!existing) throw new ActionError(`"${name}" is not currently on the shopping list.`);
    snapshotForUndo(`${checked ? "check off" : "uncheck"} "${name}" on the shopping list`, actor);
    let found = null;
    store.update((s) => {
      const item = s.shoppingList.find((i) => i.name === name && (unit ? i.unit === unit : true));
      if (item) {
        item.checked = !!checked;
        found = item;
      }
    });
    log(actor, `${checked ? "checked off" : "unchecked"} "${name}" on the shopping list`);
    return found;
  },

  getShoppingList() {
    const state = store.getState();
    return { items: state.shoppingList, itemCount: state.shoppingList.length };
  },

  getRecentActivity({ limit = 10 } = {}) {
    return store.getState().log.slice(0, limit);
  },

  /** What undoLastAction would revert right now, without doing it. */
  canUndo() {
    const top = undoStack[undoStack.length - 1];
    return top ? { canUndo: true, description: top.description, actor: top.actor } : { canUndo: false, description: null, actor: null };
  },

  /** Reverts the most recent state-changing action (single level; there is no redo). */
  undoLastAction(actor = "human") {
    const entry = undoStack.pop();
    if (!entry) throw new ActionError("Nothing to undo.");
    store.update((s) => {
      Object.assign(s, entry.snapshot);
    });
    log(actor, `undid: ${entry.description}`);
    return { undone: entry.description, undoneActor: entry.actor };
  },
};

export { ActionError };
