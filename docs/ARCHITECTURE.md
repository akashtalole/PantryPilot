# Architecture

Three diagrams, source-of-truth `.mmd` files in this folder
([`system-architecture.mmd`](diagrams/system-architecture.mmd),
[`module-dependencies.mmd`](diagrams/module-dependencies.mmd),
[`tool-call-sequence.mmd`](diagrams/tool-call-sequence.mmd)), embedded below
so they render inline on GitHub. Each was validated with the Mermaid parser
before committing.

## System architecture

Two ways to drive the page — a human clicking the UI, or an agent calling
WebMCP tools — and both funnel through the same domain logic in
`js/actions.js`, so neither has capabilities the other lacks. The Agent
Console is a third entry point reachable from the UI: it calls the exact
same tool handlers (`LocalToolRegistry`) that `document.modelContext`
registers, which is how every tool was tested and demoed without a native
WebMCP browser available in the build environment.

```mermaid
flowchart TB
    Human(["🧑 Human"])
    Agent(["🤖 AI Agent<br/>(WebMCP-enabled browser)"])

    subgraph App["Browser tab — PantryPilot (static site, no backend)"]
        direction TB
        UI["js/ui.js<br/>tabs, forms, rendering"]
        Console["Agent Console<br/>(inside ui.js — testing / demo surface)"]
        WebMCP["document.modelContext<br/>native WebMCP API"]
        Tools["js/webmcp-tools.js<br/>19 tool definitions + LocalToolRegistry"]
        Actions["js/actions.js<br/>shared domain logic<br/>(single source of truth)"]
        Recipes["js/recipes-data.js<br/>16-recipe catalog"]
        Store["js/state-store.js<br/>reactive store"]
        LS[("localStorage<br/>pantrypilot_state_v1")]
    end

    Human -->|"clicks / form submits"| UI
    Human -->|"picks a tool + JSON args"| Console
    Agent -->|"executeTool(name, args)"| WebMCP

    UI --> Actions
    Console --> Tools
    WebMCP --> Tools
    Tools --> Actions

    Actions --> Recipes
    Actions -->|"store.update()"| Store
    Store -->|"persist"| LS
    Store -.->|"'change' event"| UI

    classDef person fill:#e6f0e6,stroke:#2f6b3f,color:#1f2318
    classDef agent fill:#e8ebfa,stroke:#4356a8,color:#1f2318
    classDef core fill:#fff5e0,stroke:#b3541e,color:#1f2318
    class Human person
    class Agent agent
    class Actions core
```

## Module dependencies

The actual `import` graph. `actions.js` is the only module both the UI and
the WebMCP tool layer depend on — `state-store.js` and `recipes-data.js`
are leaves with no dependencies of their own.

```mermaid
flowchart LR
    HTML["index.html"] --> Main["main.js<br/>bootstraps the app"]
    Main --> UI["ui.js<br/>rendering + human events"]
    Main --> Tools["webmcp-tools.js<br/>tool schemas + registration"]

    UI --> Store["state-store.js<br/>reactive store"]
    UI --> Actions["actions.js<br/>shared domain logic"]
    UI --> Recipes["recipes-data.js<br/>seed catalog"]
    UI --> Tools

    Tools --> Actions
    Tools --> Store

    Actions --> Store
    Actions --> Recipes

    classDef entry fill:#e6f0e6,stroke:#2f6b3f,color:#1f2318
    classDef core fill:#fff5e0,stroke:#b3541e,color:#1f2318
    classDef leaf fill:#f3f2ee,stroke:#5b6156,color:#1f2318
    class HTML,Main entry
    class Actions core
    class Store,Recipes leaf
```

## A tool call end to end

`plan-week` is the clearest example because it shows why undo snapshots
inside each action, immediately before its actual mutation, rather than at
the tool boundary: a single call cascades into two `store.update()` calls
(the plan itself, then the shopping-list regen it triggers as a side
effect), and both need to collapse into one undo step.

```mermaid
sequenceDiagram
    actor Agent as AI Agent
    participant WebMCP as document.modelContext
    participant Tools as webmcp-tools.js
    participant Actions as actions.js
    participant Store as state-store.js
    participant UI as ui.js
    actor Human as Human (watching)

    Agent->>WebMCP: executeTool("plan-week", {...})
    WebMCP->>Tools: execute(args)
    Tools->>Actions: Actions.planWeek(args, "agent")
    Actions->>Actions: snapshotForUndo(description, "agent")
    Actions->>Store: store.update(draft => draft.plan = {...})
    Store->>Store: persist to localStorage
    Store-->>UI: dispatch "change" event
    UI->>UI: renderAll() -- plan grid, nutrition, budget

    Actions->>Actions: generateShoppingList("agent", {silent: true})
    Actions->>Store: store.update(draft => draft.shoppingList = [...])
    Store->>Store: persist to localStorage
    Store-->>UI: dispatch "change" event
    UI->>UI: renderAll() -- shopping list updates too

    Actions-->>Tools: {planned, skipped, plan, budget}
    Tools-->>WebMCP: {content: [{type: "text", text: JSON}]}
    WebMCP-->>Agent: tool result
    UI-->>Human: sees the week fill in live, no refresh
```
