import { initUI, setWebMCPStatus } from "./ui.js";
import { registerWebMCPTools } from "./webmcp-tools.js";

initUI();

registerWebMCPTools().then((nativeSupported) => {
  setWebMCPStatus(nativeSupported);
});

// Keep the tool registry live if the API supports dynamic changes; harmless
// no-op in browsers/pages where nothing ever changes the tool set.
if (typeof document !== "undefined" && document.modelContext && document.modelContext.addEventListener) {
  document.modelContext.addEventListener("toolchange", async () => {
    console.info("PantryPilot: WebMCP toolchange event received.");
  });
}
