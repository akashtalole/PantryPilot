// WebMCP tool registration for PantryPilot.
//
// Spec: https://github.com/webmachinelearning/webmcp
// Chrome docs: https://developer.chrome.com/docs/ai/webmcp
//
// Every tool here wraps a function from js/actions.js -- the exact same
// code path the human UI uses -- so an agent acting on this page has no
// more power than a human clicking through it, and every change it makes
// shows up live in the UI (and vice versa) because both read/write the one
// shared store.
import { Actions, ActionError } from "./actions.js";
import { DAYS } from "./state-store.js";

function textResult(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function errorResult(err) {
  const message = err instanceof ActionError ? err.message : `Unexpected error: ${err.message}`;
  return { content: [{ type: "text", text: message }], isError: true };
}

/**
 * Tool catalog. `execute` always receives already-parsed arguments and
 * must return the MCP tool-result shape: { content: [...], isError?: bool }.
 * Kept as plain data (not closures over a live registry) so the exact same
 * definitions can be registered with the native WebMCP API *and* driven by
 * the in-page "Agent Simulator" panel for testing when native WebMCP is
 * unavailable (e.g. this session's sandbox, or a browser without the
 * Chrome 149 origin trial / ChatGPT browser enabled).
 */
export const TOOL_DEFINITIONS = [
  {
    name: "search-recipes",
    description:
      "Search the recipe catalog by free-text query, required tags, and/or a max prep time. " +
      "By default, results are filtered to only recipes that match the household's currently active dietary preferences.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free text to match against recipe name or ingredients." },
        tags: {
          type: "array",
          items: { type: "string", enum: ["vegetarian", "vegan", "glutenFree", "dairyFree", "nutFree", "quick", "budget"] },
          description: "Require all of these tags.",
        },
        maxPrepMinutes: { type: "number", description: "Only include recipes that take this many minutes or less." },
        respectDietary: { type: "boolean", description: "Filter out recipes that conflict with active dietary preferences. Defaults to true." },
        maxCaloriesPerServing: { type: "number", description: "Only include recipes at or under this many calories per serving." },
        minProteinPerServing: { type: "number", description: "Only include recipes with at least this many grams of protein per serving." },
        sortBy: {
          type: "string",
          enum: ["relevance", "pantryMatch", "cost", "prepTime", "calories", "expiringSoon"],
          description:
            "How to order results. 'pantryMatch' ranks recipes needing the fewest additional ingredients first " +
            "-- use this to answer \"what can I make with what I already have\". 'expiringSoon' ranks recipes that " +
            "use the most soon-to-expire pantry items first -- use this to reduce food waste. Defaults to 'relevance'.",
        },
      },
    },
    handler: (args) => Actions.searchRecipes(args || {}),
  },
  {
    name: "get-recipe",
    description: "Get full details for one recipe, including ingredients and instructions, by its recipe id.",
    inputSchema: {
      type: "object",
      properties: { recipeId: { type: "string", description: "The recipe id, e.g. from search-recipes results." } },
      required: ["recipeId"],
    },
    handler: (args) => Actions.getRecipe(args),
  },
  {
    name: "get-dietary-preferences",
    description: "Get the household's currently active dietary preferences and avoided ingredients.",
    inputSchema: { type: "object", properties: {} },
    handler: () => Actions.getDietaryPreferences(),
  },
  {
    name: "set-dietary-preferences",
    description:
      "Update the household's dietary preferences (vegetarian, vegan, glutenFree, dairyFree, nutFree) and/or the list of " +
      "ingredients to avoid. Only the fields provided are changed. Affects future recipe searches and blocks conflicting " +
      "meal-plan additions unless overridden.",
    inputSchema: {
      type: "object",
      properties: {
        vegetarian: { type: "boolean" },
        vegan: { type: "boolean" },
        glutenFree: { type: "boolean" },
        dairyFree: { type: "boolean" },
        nutFree: { type: "boolean" },
        avoidIngredients: { type: "array", items: { type: "string" }, description: "Ingredient names to avoid entirely, e.g. [\"shellfish\"]." },
      },
    },
    handler: (args) => Actions.setDietaryPreferences(args || {}, "agent"),
  },
  {
    name: "get-meal-plan",
    description: "Get the full Mon-Sun meal plan with recipe names, servings, and an estimated total cost for the week.",
    inputSchema: { type: "object", properties: {} },
    handler: () => Actions.getMealPlan(),
  },
  {
    name: "get-week-nutrition-summary",
    description:
      "Get per-serving nutrition (calories, protein, carbs, fat) for each planned day plus the weekly total and the " +
      "average per planned day -- use this to answer \"how many calories a day is this plan averaging\" or check it " +
      "hits a protein target.",
    inputSchema: { type: "object", properties: {} },
    handler: () => Actions.getWeekNutritionSummary(),
  },
  {
    name: "add-recipe-to-plan",
    description:
      "Assign a recipe to a day of the week. Fails with an explanation if the recipe conflicts with active dietary " +
      "preferences unless force is true. Automatically refreshes the shopping list.",
    inputSchema: {
      type: "object",
      properties: {
        day: { type: "string", enum: DAYS, description: "Day of the week to plan." },
        recipeId: { type: "string", description: "Recipe id to assign, from search-recipes or get-recipe." },
        servings: { type: "number", description: "Servings to cook; defaults to the recipe's normal serving size." },
        force: { type: "boolean", description: "Set true to add the recipe even if it conflicts with dietary preferences." },
      },
      required: ["day", "recipeId"],
    },
    handler: (args) => Actions.addRecipeToPlan(args, "agent"),
  },
  {
    name: "remove-recipe-from-plan",
    description: "Clear whatever recipe is assigned to a given day of the week. Automatically refreshes the shopping list.",
    inputSchema: {
      type: "object",
      properties: { day: { type: "string", enum: DAYS } },
      required: ["day"],
    },
    handler: (args) => Actions.removeRecipeFromPlan(args, "agent"),
  },
  {
    name: "plan-week",
    description:
      "Automatically fill in the meal plan for multiple days at once under a set of constraints, instead of calling " +
      "add-recipe-to-plan repeatedly. Always respects active dietary preferences (never overrides them). By default " +
      "only fills empty days, avoids repeating a recipe already used that week, and -- if a weekly budget is set -- " +
      "skips a day rather than exceed it. Returns which days were planned and, for any day that couldn't be filled, why.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "array", items: { type: "string", enum: DAYS }, description: "Days to plan; defaults to all 7." },
        tags: {
          type: "array",
          items: { type: "string", enum: ["vegetarian", "vegan", "glutenFree", "dairyFree", "nutFree", "quick", "budget"] },
          description: "Require all of these tags on every recipe chosen.",
        },
        maxPrepMinutes: { type: "number", description: "Only consider recipes that take this many minutes or less." },
        avoidRepeats: { type: "boolean", description: "Don't reuse a recipe already planned elsewhere this week. Defaults to true." },
        onlyEmptyDays: { type: "boolean", description: "Only fill days with no recipe assigned yet. Defaults to true." },
        respectBudget: { type: "boolean", description: "Skip a day rather than exceed the weekly budget, if one is set. Defaults to true." },
        maxCaloriesPerServing: { type: "number", description: "Only consider recipes at or under this many calories per serving." },
        minProteinPerServing: { type: "number", description: "Only consider recipes with at least this many grams of protein per serving." },
        prioritizeExpiring: {
          type: "boolean",
          description: "Prefer recipes that use pantry items expiring soon, to reduce food waste. Defaults to false (prefers pantry match generally).",
        },
      },
    },
    handler: (args) => Actions.planWeek(args || {}, "agent"),
  },
  {
    name: "get-budget-status",
    description: "Get the weekly grocery budget (if set), the meal plan's current estimated cost, and how much room is left.",
    inputSchema: { type: "object", properties: {} },
    handler: () => Actions.getBudgetStatus(),
  },
  {
    name: "set-weekly-budget",
    description: "Set (or clear, with amount: null) the household's target weekly grocery budget in dollars.",
    inputSchema: {
      type: "object",
      properties: { amount: { type: ["number", "null"], description: "Non-negative dollar amount, or null to clear the budget." } },
      required: ["amount"],
    },
    handler: (args) => Actions.setWeeklyBudget(args, "agent"),
  },
  {
    name: "get-pantry",
    description: "List pantry staples the household is tracking and whether each is currently in stock.",
    inputSchema: { type: "object", properties: {} },
    handler: () => Actions.getPantry(),
  },
  {
    name: "update-pantry-item",
    description:
      "Mark a pantry item as in stock or needed, and/or set when it expires. Items marked 'have' are excluded from the " +
      "generated shopping list even if a planned recipe calls for them. Fields omitted are left unchanged.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Ingredient name, e.g. \"olive oil\"." },
        have: { type: "boolean", description: "true if currently stocked at home. Omit to leave unchanged." },
        expiresOn: {
          type: ["string", "null"],
          description: "ISO date string (e.g. \"2026-09-05\") this item expires on, or null to clear it. Omit to leave unchanged.",
        },
      },
      required: ["name"],
    },
    handler: (args) => Actions.updatePantryItem(args, "agent"),
  },
  {
    name: "get-expiring-soon",
    description:
      "List pantry items that are on hand and expire within the given number of days (default 3), soonest first -- " +
      "use this to plan meals that use them up and reduce food waste. A negative daysUntilExpiry means already expired.",
    inputSchema: {
      type: "object",
      properties: { withinDays: { type: "number", description: "Expiry window in days. Defaults to 3." } },
    },
    handler: (args) => Actions.getExpiringSoon(args || {}),
  },
  {
    name: "get-shopping-list",
    description: "Get the current shopping list: ingredients needed for the week's planned recipes, minus what's already in the pantry.",
    inputSchema: { type: "object", properties: {} },
    handler: () => Actions.getShoppingList(),
  },
  {
    name: "regenerate-shopping-list",
    description:
      "Recompute the shopping list from the current meal plan and pantry state. Usually unnecessary since other tools " +
      "auto-refresh it, but useful to force a recheck.",
    inputSchema: { type: "object", properties: {} },
    handler: () => Actions.generateShoppingList("agent"),
  },
  {
    name: "toggle-shopping-item",
    description: "Check or uncheck an item on the shopping list, e.g. after it's been bought.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        unit: { type: "string", description: "Optional unit to disambiguate items with the same name." },
        checked: { type: "boolean" },
      },
      required: ["name", "checked"],
    },
    handler: (args) => Actions.toggleShoppingItem(args, "agent"),
  },
  {
    name: "get-recent-activity",
    description: "Get a log of recent actions taken on this plan by either the human or an agent, most recent first.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Max entries to return, defaults to 10." } },
    },
    handler: (args) => Actions.getRecentActivity(args || {}),
  },
  {
    name: "undo-last-action",
    description:
      "Revert the single most recent state-changing action (by either the human or an agent) -- plan changes, pantry " +
      "edits, dietary/budget changes, or shopping-list edits. Only one level deep and there is no redo, so check " +
      "get-recent-activity first if you're unsure what it would undo. Fails if there's nothing to undo.",
    inputSchema: { type: "object", properties: {} },
    handler: () => Actions.undoLastAction("agent"),
  },
];

async function runTool(def, args) {
  try {
    const result = def.handler(args || {});
    return textResult(result);
  } catch (err) {
    return errorResult(err);
  }
}

/** In-page registry used by the Agent Simulator panel, regardless of native WebMCP support. */
export const LocalToolRegistry = {
  list: () => TOOL_DEFINITIONS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  call: (name, args) => {
    const def = TOOL_DEFINITIONS.find((t) => t.name === name);
    if (!def) return Promise.resolve(errorResult(new Error(`Unknown tool "${name}".`)));
    return runTool(def, args);
  },
};

/**
 * Registers every tool with the native WebMCP API when available
 * (document.modelContext, per the current explainer/Chrome implementation).
 * Returns true if native registration happened, false if the API isn't
 * present in this browser -- in which case the app still works fully via
 * the Agent Simulator panel and the ordinary UI.
 */
export async function registerWebMCPTools() {
  const modelContext = typeof document !== "undefined" ? document.modelContext : undefined;
  if (!modelContext || typeof modelContext.registerTool !== "function") {
    console.info("PantryPilot: native WebMCP (document.modelContext) not detected in this browser.");
    return false;
  }
  for (const def of TOOL_DEFINITIONS) {
    try {
      await modelContext.registerTool({
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        async execute(args) {
          return runTool(def, args);
        },
      });
    } catch (err) {
      console.error(`PantryPilot: failed to register WebMCP tool "${def.name}"`, err);
    }
  }
  console.info(`PantryPilot: registered ${TOOL_DEFINITIONS.length} WebMCP tools with document.modelContext.`);
  return true;
}
