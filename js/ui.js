import { store, DAYS } from "./state-store.js";
import { Actions, ActionError } from "./actions.js";
import { RECIPES, findRecipeById } from "./recipes-data.js";
import { LocalToolRegistry } from "./webmcp-tools.js";

const ALL_TAGS = ["vegetarian", "vegan", "glutenFree", "dairyFree", "nutFree", "quick", "budget"];
const TAG_LABEL = { glutenFree: "gluten-free", dairyFree: "dairy-free", nutFree: "nut-free" };

const state = {
  activeTag: null,
  searchQuery: "",
  sortBy: "relevance",
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  Object.entries(props).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  children.forEach((c) => node.appendChild(typeof c === "string" ? document.createTextNode(c) : c));
  return node;
};

function tagLabel(t) {
  return TAG_LABEL[t] || t;
}

// ---------- Tabs ----------
function initBudgetForm() {
  $("#budget-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = $("#budget-input").value.trim();
    Actions.setWeeklyBudget({ amount: raw === "" ? null : Number(raw) }, "human");
  });
}

function initAutofillWeek() {
  $("#autofill-week").addEventListener("click", () => {
    const result = Actions.planWeek({}, "human");
    if (!result.planned.length && result.skipped.length) {
      alert(
        "Couldn't auto-fill any days:\n" + result.skipped.map((s) => `${s.day}: ${s.reason}`).join("\n")
      );
    }
  });
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
      $(`#tab-${btn.dataset.tab}`).classList.remove("hidden");
    });
  });
}

// ---------- Dietary bar ----------
function renderDietaryBar() {
  const bar = $("#dietary-bar");
  bar.innerHTML = "";
  const dietary = Actions.getDietaryPreferences();
  ["vegetarian", "vegan", "glutenFree", "dairyFree", "nutFree"].forEach((flag) => {
    const chip = el(
      "button",
      {
        class: `diet-chip${dietary[flag] ? " on" : ""}`,
        type: "button",
        onclick: () => Actions.setDietaryPreferences({ [flag]: !dietary[flag] }, "human"),
      },
      [tagLabel(flag)]
    );
    bar.appendChild(chip);
  });
}

// ---------- Meal plan ----------
function renderPlan() {
  const grid = $("#plan-grid");
  grid.innerHTML = "";
  const { days, weekEstCost } = Actions.getMealPlan();
  $("#week-cost").textContent = `Estimated cost: $${weekEstCost.toFixed(2)}`;

  const budget = Actions.getBudgetStatus();
  const budgetEl = $("#budget-status");
  if (budget.weeklyBudget == null) {
    budgetEl.textContent = "";
    budgetEl.classList.remove("over");
  } else {
    budgetEl.textContent = budget.overBudget
      ? `$${weekEstCost.toFixed(2)} of $${budget.weeklyBudget.toFixed(2)} budget — over by $${Math.abs(budget.remaining).toFixed(2)}`
      : `$${weekEstCost.toFixed(2)} of $${budget.weeklyBudget.toFixed(2)} budget — $${budget.remaining.toFixed(2)} left`;
    budgetEl.classList.toggle("over", budget.overBudget);
  }
  $("#budget-input").value = budget.weeklyBudget ?? "";

  const nutrition = Actions.getWeekNutritionSummary();
  const nutritionEl = $("#nutrition-summary");
  nutritionEl.textContent = nutrition.avgPerPlannedDay
    ? `Avg per planned day: ${nutrition.avgPerPlannedDay.calories} kcal · ${nutrition.avgPerPlannedDay.proteinG}g protein · ` +
      `${nutrition.avgPerPlannedDay.carbsG}g carbs · ${nutrition.avgPerPlannedDay.fatG}g fat`
    : "";

  days.forEach(({ day, recipe }) => {
    const card = el("div", { class: "day-card" });
    card.appendChild(el("h3", {}, [day]));
    if (recipe) {
      const fullRecipe = findRecipeById(recipe.id);
      card.appendChild(el("div", { class: "recipe-name" }, [recipe.name]));
      card.appendChild(el("div", { class: "meta" }, [`${recipe.servings} servings · ~$${recipe.estCost.toFixed(2)}`]));
      if (fullRecipe) card.appendChild(el("div", { class: "meta" }, [`${fullRecipe.nutrition.calories} kcal/serving`]));
      card.appendChild(
        el("button", { class: "clear-btn", type: "button", onclick: () => Actions.removeRecipeFromPlan({ day }, "human") }, [
          "Clear",
        ])
      );
    } else {
      const select = el("select", {}, [
        el("option", { value: "" }, ["Add a recipe…"]),
        ...RECIPES.map((r) => el("option", { value: r.id }, [r.name])),
      ]);
      select.addEventListener("change", () => {
        if (!select.value) return;
        try {
          Actions.addRecipeToPlan({ day, recipeId: select.value }, "human");
        } catch (err) {
          if (err instanceof ActionError) {
            if (confirm(`${err.message}\n\nAdd it anyway?`)) {
              Actions.addRecipeToPlan({ day, recipeId: select.value, force: true }, "human");
            }
          } else throw err;
        }
      });
      card.appendChild(select);
    }
    grid.appendChild(card);
  });
}

// ---------- Recipes ----------
function renderTagFilters() {
  const wrap = $("#tag-filters");
  wrap.innerHTML = "";
  ALL_TAGS.forEach((tag) => {
    const btn = el(
      "button",
      {
        type: "button",
        class: state.activeTag === tag ? "on" : "",
        onclick: () => {
          state.activeTag = state.activeTag === tag ? null : tag;
          renderRecipes();
          renderTagFilters();
        },
      },
      [tagLabel(tag)]
    );
    wrap.appendChild(btn);
  });
}

function renderRecipes() {
  const grid = $("#recipe-grid");
  grid.innerHTML = "";
  const results = Actions.searchRecipes({
    query: state.searchQuery,
    tags: state.activeTag ? [state.activeTag] : undefined,
    respectDietary: false,
    sortBy: state.sortBy,
  });

  results.forEach((r) => {
    const card = el("div", { class: "recipe-card" });
    card.appendChild(el("h3", {}, [r.name]));
    card.appendChild(el("div", { class: "tags" }, r.tags.map((t) => el("span", { class: "tag" }, [tagLabel(t)]))));
    card.appendChild(el("div", { class: "meta" }, [`${r.prepMinutes} min · ${r.servings} servings · ~$${r.costPerServing.toFixed(2)}/serving`]));
    card.appendChild(el("div", { class: "meta" }, [`${r.nutrition.calories} kcal · ${r.nutrition.proteinG}g protein`]));
    if (r.pantryMatch.missing === 0) {
      card.appendChild(el("div", { class: "pantry-match" }, ["✓ You have everything for this"]));
    } else if (r.pantryMatch.missing < r.pantryMatch.total) {
      card.appendChild(el("div", { class: "pantry-match" }, [`${r.pantryMatch.total - r.pantryMatch.missing}/${r.pantryMatch.total} ingredients already on hand`]));
    }
    if (r.usesExpiringSoon > 0) {
      card.appendChild(el("div", { class: "expiring" }, [`⏳ uses ${r.usesExpiringSoon} item(s) expiring soon`]));
    }
    if (r.dietaryConflicts.length) {
      card.appendChild(el("div", { class: "conflict" }, [`⚠ ${r.dietaryConflicts.join(", ")}`]));
    }
    const daySelect = el("select", {}, DAYS.map((d) => el("option", { value: d }, [d])));
    const addBtn = el("button", {
      type: "button",
      onclick: () => {
        try {
          Actions.addRecipeToPlan({ day: daySelect.value, recipeId: r.id }, "human");
        } catch (err) {
          if (err instanceof ActionError) {
            if (confirm(`${err.message}\n\nAdd it anyway?`)) {
              Actions.addRecipeToPlan({ day: daySelect.value, recipeId: r.id, force: true }, "human");
            }
          } else throw err;
        }
      },
    }, ["Add"]);
    card.appendChild(el("div", { class: "add-row" }, [daySelect, addBtn]));
    grid.appendChild(card);
  });
}

function initRecipeSearch() {
  $("#recipe-search").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderRecipes();
  });
  $("#sort-select").addEventListener("change", (e) => {
    state.sortBy = e.target.value;
    renderRecipes();
  });
}

// ---------- Pantry ----------
function renderPantry() {
  const list = $("#pantry-list");
  list.innerHTML = "";
  Actions.getPantry().forEach(({ name, have, expiresOn, daysUntilExpiry }) => {
    const checkbox = el("input", { type: "checkbox" });
    checkbox.checked = have;
    checkbox.addEventListener("change", () => Actions.updatePantryItem({ name, have: checkbox.checked }, "human"));

    const expiryInput = el("input", { type: "date" });
    expiryInput.value = expiresOn || "";
    expiryInput.addEventListener("change", () =>
      Actions.updatePantryItem({ name, expiresOn: expiryInput.value || null }, "human")
    );

    const li = el("li", {}, [checkbox, el("span", { class: "name" }, [name]), expiryInput]);
    if (have && expiresOn) {
      const label = daysUntilExpiry < 0 ? "expired" : daysUntilExpiry === 0 ? "expires today" : `expires in ${daysUntilExpiry}d`;
      li.appendChild(el("span", { class: `expiry-badge${daysUntilExpiry <= 3 ? " soon" : ""}` }, [label]));
    }
    list.appendChild(li);
  });
}

function initPantryForm() {
  $("#add-pantry-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("#add-pantry-input");
    const expiryInput = $("#add-pantry-expiry");
    const name = input.value.trim();
    if (!name) return;
    Actions.updatePantryItem({ name, have: true, expiresOn: expiryInput.value || null }, "human");
    input.value = "";
    expiryInput.value = "";
  });
}

// ---------- Shopping list ----------
function renderShoppingList() {
  const list = $("#shopping-list");
  list.innerHTML = "";
  const { items } = Actions.getShoppingList();
  if (!items.length) {
    list.appendChild(el("li", {}, ["Nothing needed — plan some meals or your pantry has it all covered."]));
    return;
  }
  items.forEach((item) => {
    const checkbox = el("input", { type: "checkbox" });
    checkbox.checked = item.checked;
    checkbox.addEventListener("change", () =>
      Actions.toggleShoppingItem({ name: item.name, unit: item.unit, checked: checkbox.checked }, "human")
    );
    const li = el("li", { class: item.checked ? "checked" : "" }, [
      checkbox,
      el("span", { class: "name" }, [item.name]),
      el("span", { class: "qty" }, [`${item.qty} ${item.unit}`]),
    ]);
    list.appendChild(li);
  });
}

function initShoppingControls() {
  $("#regen-shopping").addEventListener("click", () => Actions.generateShoppingList("human"));
}

// ---------- Activity log ----------
function renderActivityLog() {
  const undoBtn = $("#undo-btn");
  const undo = Actions.canUndo();
  undoBtn.disabled = !undo.canUndo;
  undoBtn.textContent = undo.canUndo ? `Undo: ${undo.description}` : "Undo";

  const list = $("#activity-log");
  list.innerHTML = "";
  const entries = Actions.getRecentActivity({ limit: 25 });
  if (!entries.length) {
    list.appendChild(el("li", {}, ["No activity yet."]));
    return;
  }
  entries.forEach((entry) => {
    const time = new Date(entry.ts).toLocaleTimeString();
    const li = el("li", {}, [
      el("span", { class: `actor ${entry.actor}` }, [entry.actor]),
      entry.message,
      el("span", { class: "ts" }, [time]),
    ]);
    list.appendChild(li);
  });
}

function initUndoButton() {
  $("#undo-btn").addEventListener("click", () => {
    try {
      Actions.undoLastAction("human");
    } catch (err) {
      if (err instanceof ActionError) alert(err.message);
      else throw err;
    }
  });
}

// ---------- Agent console (fallback / testing surface) ----------
const EXAMPLE_ARGS = {
  "search-recipes": { query: "", tags: [], maxPrepMinutes: 30 },
  "get-recipe": { recipeId: "chickpea-curry" },
  "get-dietary-preferences": {},
  "set-dietary-preferences": { vegan: true },
  "get-meal-plan": {},
  "get-week-nutrition-summary": {},
  "add-recipe-to-plan": { day: "Mon", recipeId: "chickpea-curry" },
  "remove-recipe-from-plan": { day: "Mon" },
  "plan-week": { maxPrepMinutes: 30, avoidRepeats: true, onlyEmptyDays: true },
  "get-budget-status": {},
  "set-weekly-budget": { amount: 60 },
  "get-pantry": {},
  "update-pantry-item": { name: "quinoa", have: true, expiresOn: null },
  "get-expiring-soon": { withinDays: 3 },
  "get-shopping-list": {},
  "regenerate-shopping-list": {},
  "toggle-shopping-item": { name: "onion", checked: true },
  "get-recent-activity": { limit: 10 },
  "undo-last-action": {},
};

function initAgentConsole() {
  const select = $("#tool-select");
  select.innerHTML = "";
  LocalToolRegistry.list().forEach((t) => {
    select.appendChild(el("option", { value: t.name, title: t.description }, [t.name]));
  });
  const argsBox = $("#tool-args");
  const setExample = () => {
    argsBox.value = JSON.stringify(EXAMPLE_ARGS[select.value] ?? {}, null, 2);
  };
  select.addEventListener("change", setExample);
  setExample();

  $("#tool-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const resultBox = $("#tool-result");
    let args;
    try {
      args = JSON.parse(argsBox.value || "{}");
    } catch (err) {
      resultBox.textContent = `Invalid JSON arguments: ${err.message}`;
      return;
    }
    const result = await LocalToolRegistry.call(select.value, args);
    const text = result.content.map((c) => c.text).join("\n");
    resultBox.textContent = (result.isError ? "ERROR\n" : "") + text;
  });
}

// ---------- WebMCP status badge ----------
export function setWebMCPStatus(nativeSupported) {
  const badge = $("#webmcp-status");
  if (nativeSupported) {
    badge.textContent = "✓ WebMCP tools registered natively (document.modelContext)";
    badge.classList.remove("inactive");
  } else {
    badge.textContent = "WebMCP not detected — using in-page Agent Console for testing (see 'Activity & Agent Console' tab)";
    badge.classList.add("inactive");
  }
}

// ---------- Render everything ----------
function renderAll() {
  renderDietaryBar();
  renderPlan();
  renderTagFilters();
  renderRecipes();
  renderPantry();
  renderShoppingList();
  renderActivityLog();
}

export function initUI() {
  initTabs();
  initRecipeSearch();
  initPantryForm();
  initShoppingControls();
  initBudgetForm();
  initAutofillWeek();
  initUndoButton();
  initAgentConsole();
  renderAll();
  store.addEventListener("change", renderAll);
}
