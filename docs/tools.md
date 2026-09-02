# WebMCP Tools

PantryPilot registers 19 tools via `document.modelContext.registerTool()`.
Every one of them wraps a function in
[`js/actions.js`](https://github.com/akashtalole/PantryPilot/blob/main/js/actions.js) —
the same functions the human-facing UI calls — so an agent using these
tools has no more power over the page than a person clicking through it.
Full JSON Schemas live in
[`js/webmcp-tools.js`](https://github.com/akashtalole/PantryPilot/blob/main/js/webmcp-tools.js).

## Recipes

| Tool | What it does |
|---|---|
| `search-recipes` | Search by text, required tags, max prep time, calories, or protein. Filters out anything that conflicts with active dietary preferences by default. Accepts `sortBy`: `"pantryMatch"` (fewest missing ingredients first), `"expiringSoon"` (uses the most soon-to-expire pantry items first), `"cost"`, `"prepTime"`, or `"calories"`. |
| `get-recipe` | Full ingredient list and instructions for one recipe by id. |

## Dietary preferences

| Tool | What it does |
|---|---|
| `get-dietary-preferences` | Read the household's active preferences. |
| `set-dietary-preferences` | Update vegetarian / vegan / gluten-free / dairy-free / nut-free flags and/or a free-form list of ingredients to avoid entirely. |

## Meal plan

| Tool | What it does |
|---|---|
| `get-meal-plan` | The full Mon–Sun plan with an estimated total weekly cost. |
| `get-week-nutrition-summary` | Per-day and average calories/protein/carbs/fat across whatever's currently planned. |
| `add-recipe-to-plan` | Assign a recipe to one day. **Refuses if the recipe conflicts with active dietary preferences**, unless `force: true` is passed. |
| `remove-recipe-from-plan` | Clear whatever's assigned to a day. |
| `plan-week` | Fill in multiple empty days at once under constraints — tags, max prep time, a calorie/protein ceiling, the remaining budget, and an optional "prioritize what's expiring" mode. Never overrides an active dietary restriction, and never repeats a recipe within the same week unless told to. Returns exactly what it planned and, for anything it skipped, why. |

## Budget

| Tool | What it does |
|---|---|
| `get-budget-status` | The current weekly budget (if set), the plan's estimated cost, and how much room is left. |
| `set-weekly-budget` | Set (or clear, with `amount: null`) a target weekly grocery budget. `plan-week` will skip a day rather than exceed it. |

## Pantry

| Tool | What it does |
|---|---|
| `get-pantry` | List everything the household is tracking and whether it's currently in stock. |
| `update-pantry-item` | Mark an item as in stock or needed, and/or set an expiry date. |
| `get-expiring-soon` | Items on hand that expire within N days (default 3), soonest first — the basis for reducing food waste. |

## Shopping list

| Tool | What it does |
|---|---|
| `get-shopping-list` | The ingredients still needed for the week, aggregated across every planned recipe and offset by the pantry. |
| `regenerate-shopping-list` | Force a recompute from the current plan and pantry state. |
| `toggle-shopping-item` | Check or uncheck an item, e.g. after buying it. |

## Activity & safety

| Tool | What it does |
|---|---|
| `get-recent-activity` | A log of what's happened recently, tagged by whether a human or an agent did it. |
| `undo-last-action` | Revert the single most recent state-changing action, by either party. One level deep — there's no redo. Every mutating tool snapshots state immediately before it changes, so this always undoes exactly one logical action, even when that action triggered internal side effects (like a shopping-list regeneration). |

## Trying them

See [How to Use → Trying it without a WebMCP-capable browser](usage.md#trying-it-without-a-webmcp-capable-browser)
for a step-by-step walkthrough of the in-page Agent Console, which calls
these same tool handlers directly.
