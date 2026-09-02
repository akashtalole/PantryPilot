// Tiny reactive store backed by localStorage. Both the human UI and the
// WebMCP tools read/write through this single store, so a change made by
// either party is immediately visible to the other.
const STORAGE_KEY = "pantrypilot_state_v1";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function defaultState() {
  return {
    version: 1,
    dietary: {
      vegetarian: false,
      vegan: false,
      glutenFree: false,
      dairyFree: false,
      nutFree: false,
      avoidIngredients: [],
    },
    pantry: {
      "olive oil": { have: true, expiresOn: null },
      salt: { have: true, expiresOn: null },
      pepper: { have: true, expiresOn: null },
      garlic: { have: true, expiresOn: null },
      onion: { have: true, expiresOn: null },
    },
    plan: Object.fromEntries(DAYS.map((d) => [d, null])),
    weeklyBudget: null,
    shoppingList: [],
    log: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    // Merge with defaults so new fields introduced later don't break old saves.
    const base = defaultState();
    return {
      ...base,
      ...parsed,
      dietary: { ...base.dietary, ...(parsed.dietary || {}) },
      pantry: { ...base.pantry, ...(parsed.pantry || {}) },
      plan: { ...base.plan, ...(parsed.plan || {}) },
      shoppingList: parsed.shoppingList || [],
      log: parsed.log || [],
    };
  } catch (err) {
    console.warn("PantryPilot: failed to load saved state, resetting.", err);
    return defaultState();
  }
}

class Store extends EventTarget {
  constructor() {
    super();
    this.state = loadState();
  }

  getState() {
    return this.state;
  }

  /** Apply an updater(draftState) function, persist, and notify subscribers. */
  update(updater) {
    updater(this.state);
    this._persist();
    this.dispatchEvent(new CustomEvent("change", { detail: this.state }));
  }

  reset() {
    this.state = defaultState();
    this._persist();
    this.dispatchEvent(new CustomEvent("change", { detail: this.state }));
  }

  _persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.warn("PantryPilot: failed to persist state.", err);
    }
  }
}

export const store = new Store();
export { DAYS };
