# PantryPilot

A meal-planning and shopping-list app built for **[The WebMCP Challenge](https://webmcp.devpost.com/)**.

**[Live demo](https://zingy-hamster-1df2ed.netlify.app/)** ·
**[Full documentation](https://akashtalole.github.io/PantryPilot/)** ·
**[On Devpost](https://devpost.com/software/webmcp-btw3nd)**

PantryPilot is an ordinary, useful web app — plan a week of dinners, respect
dietary restrictions, track pantry staples, get an auto-generated shopping
list — that becomes something new once an AI agent can drive it directly.
Instead of an agent scraping the DOM or simulating clicks, this page exposes
its real capabilities as **WebMCP tools**, so a human and an agent can plan
the same week together, live, in the same shared state.

> "You have chicken, no dairy, and 20 minutes on Tuesdays. Plan my week and
> build the shopping list" is a sentence an agent can now *act on*, not just
> answer.

## Why this fits the challenge theme

The theme asks for apps that are "meaningfully enhanced when both humans and
AI agents can use them collaboratively." PantryPilot is built so that:

- **Every mutation goes through one shared core** (`js/actions.js`). The human
  UI and the WebMCP tools call the *exact same functions* — an agent has no
  more power over the page than a human clicking through it, and neither
  surface can drift out of sync with the other.
- **State is shared and reactive.** Both surfaces read/write the same
  `localStorage`-backed store (`js/state-store.js`). If an agent plans Monday's
  dinner while you're looking at the page, the meal-plan grid updates in
  front of you immediately — no refresh.
- **The activity log is a shared record.** Every action is tagged `human` or
  `agent`, so it's obvious afterward who did what — this is what makes it
  feel like *collaboration* rather than automation happening behind your back.
- **Real constraints are enforced, not just described.** Dietary preferences
  (vegetarian / vegan / gluten-free / dairy-free / nut-free / avoided
  ingredients) actually block conflicting meal-plan additions unless the
  caller explicitly overrides (`force: true`) — a small but real example of a
  tool doing more than "click this button."
- **Agent actions are reversible.** Every mutation snapshots state just
  before it changes; a human (or the agent itself) can call `undo-last-action`
  to revert the most recent change, plan mutation, pantry edit, or otherwise
  — the kind of safety net the [WebMCP security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
  on agent trust is actually about, implemented rather than just mentioned.

## What an agent can do here

Nineteen WebMCP tools are registered on page load via
`document.modelContext.registerTool()`:

| Tool | Purpose |
|---|---|
| `search-recipes` | Search by text, tags, max prep time, calories, or protein; filters out dietary conflicts by default |
| `get-recipe` | Full ingredient/instruction detail for one recipe |
| `get-dietary-preferences` / `set-dietary-preferences` | Read/update vegetarian, vegan, gluten-free, dairy-free, nut-free, and a free-form avoid-list |
| `get-meal-plan` | The full Mon–Sun plan with an estimated weekly cost |
| `get-week-nutrition-summary` | Per-day and average calories/protein/carbs/fat across the planned week |
| `add-recipe-to-plan` | Assign a recipe to a day; refuses on a dietary conflict unless `force: true` |
| `remove-recipe-from-plan` | Clear a day |
| `plan-week` | Fill in multiple days at once under constraints (tags, prep time, calories, budget, expiring-soon priority) — the "plan my week" tool, not just single-day CRUD |
| `get-budget-status` / `set-weekly-budget` | Read/set a target weekly grocery budget; `plan-week` skips a day rather than exceed it |
| `get-pantry` / `update-pantry-item` | Read/update what's stocked at home, including an optional expiry date |
| `get-expiring-soon` | Pantry items on hand expiring within N days, soonest first — reduce food waste |
| `get-shopping-list` / `regenerate-shopping-list` | The ingredients still needed for the week, aggregated across recipes and offset by the pantry |
| `toggle-shopping-item` | Check an item off after buying it |
| `get-recent-activity` | See what's happened recently, including the human's own actions |
| `undo-last-action` | Revert the single most recent state-changing action, by human or agent |

`search-recipes` (and `plan-week`) also accept `sortBy`/ranking options —
`"pantryMatch"` ranks "what can I make with what I already have,"
`"expiringSoon"` ranks recipes using ingredients about to go bad — real
ranking logic over live pantry/expiry state, not just a filter.

Full schemas are in [`js/webmcp-tools.js`](js/webmcp-tools.js).

## Using it

See **[How to Use](https://akashtalole.github.io/PantryPilot/usage/)** in the
docs for a full walkthrough with screenshots, including exact steps to
enable WebMCP in Chrome so the page registers its tools natively.

**As a human:** open the [live demo](https://zingy-hamster-1df2ed.netlify.app/)
(or `index.html` locally) and click through the Meal Plan / Recipes /
Pantry / Shopping List tabs like any normal app.

**As an agent:** open the page in a WebMCP-capable client (Chrome with the
`chrome://flags/#enable-webmcp-testing` flag enabled, Chrome 149+ with the
[WebMCP origin trial](https://developer.chrome.com/blog/ai-webmcp-origin-trial),
or ChatGPT's in-app browser) and ask it to plan meals, respect a diet, or
build a shopping list. The page's WebMCP status badge in the header confirms
whether native registration succeeded.

**Testing without a WebMCP-capable browser:** the "Activity & Agent Console"
tab exposes an in-page console that calls the *identical* tool handlers
(`LocalToolRegistry` in `js/webmcp-tools.js`) that are registered with
`document.modelContext`. Pick a tool, edit the JSON arguments, run it, and
watch the rest of the UI update live — this is how the tool surface was
built and verified in an environment without a WebMCP origin trial available,
and it doubles as a fast way for judges/reviewers to see every tool work
without installing anything.

## Project structure

```
index.html            Page shell and all static markup
css/style.css          Styling
js/recipes-data.js     Seed recipe catalog (16 recipes)
js/state-store.js      Reactive, localStorage-backed state store
js/actions.js          Shared domain logic — the single source of truth
js/webmcp-tools.js     WebMCP tool schemas + document.modelContext registration
js/ui.js               Human-facing rendering and event wiring
js/main.js             Bootstraps the app and registers tools
```

No build step, no backend, no dependencies — it's a static site, deployable
anywhere (Netlify, Vercel, Cloudflare Pages, GitHub Pages, Render). See
`_headers` / `netlify.toml` / `vercel.json` for the `Permissions-Policy:
tools=(self)` header WebMCP tooling expects (this matches the default, but
is set explicitly for clarity per the
[Chrome WebMCP docs](https://developer.chrome.com/docs/ai/webmcp)).

## Security notes

Per the [WebMCP security guide](https://developer.chrome.com/docs/ai/webmcp/secure-tools):

- Tools are same-origin only (`tools=(self)`); no cross-origin tool exposure.
- Every tool argument is validated inside `js/actions.js` before it touches
  state (unknown days/recipe ids/pantry names are rejected with a clear
  error, not silently accepted).
- Tools can only do what the human UI can already do — plan meals, adjust a
  pantry list, check off groceries. There is no destructive, financial, or
  irreversible action a tool can take.
- Nothing here talks to a third-party API or sends data off-device; all
  state lives in the browser's `localStorage`.

## Local development

```
python3 -m http.server 8000
# open http://localhost:8000
```

## Tests

Core domain logic (`js/actions.js`) has a unit test suite (32 tests) covering
dietary conflict enforcement, shopping-list aggregation/pantry offsetting,
budget math, the `plan-week` bulk planner (empty-day-only filling, no-repeats,
budget-aware skipping, dietary safety), nutrition filtering/summaries,
expiry-aware pantry ranking, and the undo system (including that a single
action's cascaded internal updates only ever produce one undo step):

```
npm test
```

## License

MIT — see [`LICENSE`](LICENSE).
