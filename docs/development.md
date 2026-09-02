# Development

No build step, no backend, no dependencies for the app itself — it's a
static site. Node is only needed to run the test suite and this docs site.

## Project structure

```
index.html            Page shell and all static markup
css/style.css          Styling
js/recipes-data.js     Seed recipe catalog (16 recipes)
js/state-store.js      Reactive, localStorage-backed state store
js/actions.js          Shared domain logic -- the single source of truth
js/webmcp-tools.js     WebMCP tool schemas + document.modelContext registration
js/ui.js               Human-facing rendering and event wiring
js/main.js             Bootstraps the app and registers tools
tests/                 node:test unit suite against js/actions.js
docs/                  This documentation site (MkDocs)
```

See [Architecture](ARCHITECTURE.md) for how these pieces fit together.

## Running it locally

```bash
git clone https://github.com/akashtalole/PantryPilot.git
cd PantryPilot
python3 -m http.server 8000
# open http://localhost:8000
```

## Running the tests

Core domain logic (`js/actions.js`) has a unit test suite (32 tests) covering
dietary conflict enforcement, shopping-list aggregation/pantry offsetting,
budget math, the `plan-week` bulk planner (empty-day-only filling,
no-repeats, budget-aware skipping, dietary safety), nutrition
filtering/summaries, expiry-aware pantry ranking, and the undo system
(including that a single action's cascaded internal updates only ever
produce one undo step):

```bash
npm test
```

## Deploying

Deployable anywhere that serves static files — Netlify, Vercel, Cloudflare
Pages, GitHub Pages, Render. `_headers` (Netlify) and `netlify.toml` /
`vercel.json` set the `Permissions-Policy: tools=(self)` header WebMCP
tooling expects. This matches the default same-origin tool policy, but is
set explicitly for clarity per the
[Chrome WebMCP docs](https://developer.chrome.com/docs/ai/webmcp).

## Working on this docs site

This site is built with [MkDocs](https://www.mkdocs.org/) and the
[Material theme](https://squidfunk.github.io/mkdocs-material/), and deploys
automatically to GitHub Pages on every push to `main` that touches `docs/`
or `mkdocs.yml` (see `.github/workflows/docs.yml`).

To preview it locally:

```bash
pip install mkdocs-material
mkdocs serve
# open http://localhost:8000
```

## Security notes

Per the [WebMCP security guide](https://developer.chrome.com/docs/ai/webmcp/secure-tools):

- Tools are same-origin only (`tools=(self)`); no cross-origin tool exposure.
- Every tool argument is validated inside `js/actions.js` before it touches
  state (unknown days/recipe ids/pantry names are rejected with a clear
  error, not silently accepted).
- Tools can only do what the human UI can already do — plan meals, adjust a
  pantry list, check off groceries. There is no destructive, financial, or
  irreversible action a tool can take, and the single most recent action can
  always be undone (see `undo-last-action` in the [tool reference](tools.md)).
- Nothing here talks to a third-party API or sends data off-device; all
  state lives in the browser's `localStorage`.

## License

MIT — see [`LICENSE`](https://github.com/akashtalole/PantryPilot/blob/main/LICENSE).
