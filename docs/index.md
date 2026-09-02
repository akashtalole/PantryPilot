# PantryPilot

A meal-planning and shopping-list app built for **[The WebMCP Challenge](https://webmcp.devpost.com/)**.

PantryPilot is an ordinary, useful web app — plan a week of dinners, respect
dietary restrictions, track pantry staples, get an auto-generated shopping
list — that becomes something new once an AI agent can drive it directly.
Instead of an agent scraping the DOM or simulating clicks, this page exposes
its real capabilities as **WebMCP tools**, so a human and an agent can plan
the same week together, live, in the same shared state.

!!! quote ""
    "You have chicken, no dairy, and 20 minutes on Tuesdays. Plan my week and
    build the shopping list" is a sentence an agent can now *act on*, not
    just answer.

[Try the live demo](https://zingy-hamster-1df2ed.netlify.app/){ .md-button .md-button--primary }
[How to use it](usage.md){ .md-button }
[See it on Devpost](https://devpost.com/software/webmcp-btw3nd){ .md-button }

## Why this fits the challenge theme

The theme asks for apps that are "meaningfully enhanced when both humans and
AI agents can use them collaboratively." PantryPilot is built so that:

- **Every mutation goes through one shared core** (`js/actions.js`). The human
  UI and the WebMCP tools call the *exact same functions* — an agent has no
  more power over the page than a human clicking through it, and neither
  surface can drift out of sync with the other.
- **State is shared and reactive.** Both surfaces read/write the same
  `localStorage`-backed store (`js/state-store.js`). If an agent plans
  Monday's dinner while you're looking at the page, the meal-plan grid
  updates in front of you immediately — no refresh.
- **The activity log is a shared record.** Every action is tagged `human` or
  `agent`, so it's obvious afterward who did what — this is what makes it
  feel like *collaboration* rather than automation happening behind your
  back.
- **Real constraints are enforced, not just described.** Dietary preferences
  actually block conflicting meal-plan additions unless the caller
  explicitly overrides (`force: true`) — a small but real example of a tool
  doing more than "click this button."
- **Agent actions are reversible.** Every mutation snapshots state just
  before it changes; a human (or the agent itself) can call
  `undo-last-action` to revert the most recent change — the kind of safety
  net the [WebMCP security guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools)
  on agent trust is actually about, implemented rather than just mentioned.

## Where to go next

| Page | What's there |
|---|---|
| [How to Use](usage.md) | Walk through the live demo as a human, then as an agent — with screenshots and exact steps to enable WebMCP yourself |
| [WebMCP Tools](tools.md) | All 19 registered tools, their JSON Schemas, and what each one actually enforces |
| [Architecture](ARCHITECTURE.md) | Diagrams: the human/agent/shared-core system design, the module dependency graph, and a full tool-call sequence |
| [Development](development.md) | Run it locally, run the test suite, project structure, security notes |

## License

MIT — see [`LICENSE`](https://github.com/akashtalole/PantryPilot/blob/main/LICENSE).
