import { requireAuth, logout } from "./authentication.js";
import { loadThemesFromYaml } from "./themes.js";
import { initSettings } from "./settings.js";
import { initCompendiums } from "./compendiums.js";
import { initEntries } from "./entries.js";

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

const routeTabs = new Map([
  ["compendiums", "compendiums"],
  ["compendium-detail", "compendiums"],
  ["settings", "settings"]
]);

function setRoute(route) {
  const activeTab = routeTabs.get(route) || route;
  $$(".tab").forEach(b => b.classList.toggle("is-active", b.dataset.route === activeTab));
  $$(".view").forEach(v => v.classList.toggle("is-active", v.dataset.view === route));
}

function initTabs() {
  $$(".tab").forEach(b => b.addEventListener("click", () => setRoute(b.dataset.route)));
}

(async function main() {
  initTabs();

  document.addEventListener("app:route", (event) => {
    if (event?.detail?.route) {
      setRoute(event.detail.route);
    }
  });

  const user = await requireAuth({ redirectTo: "./login.html" });

  $("#userName").textContent = user.email || user.uid;

  $("#signOutLink").addEventListener("click", async (e) => {
    e.preventDefault();
    await logout();
    window.location.href = "./login.html";
  });

  // Themes (ONLY from themes.yaml)
  let themes = [];
  try {
    themes = await loadThemesFromYaml({ allowedIds: ["monokai-dark", "monokai-light"] });
  } catch (e) {
    console.error(e);
    // UI will keep CSS defaults; settings will disable selector if themes are missing
  }

  await initSettings({
    user,
    themes,
    themeSelectEl: $("#themeSelect")
  });

  const entries = initEntries({ user });

  initCompendiums({
    user,
    onSelectCompendium: (scope, compId, compDoc) => {
      entries.setActiveCompendium(scope, compId, compDoc);
    }
  });

  // default route
  setRoute("compendiums");
})();
