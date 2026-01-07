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
  ["compendium-reader", "compendiums"],
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

function initEditorTabs() {
  document.querySelectorAll("[data-editor-tabs]").forEach((tabset) => {
    const panel = tabset.closest(".panel");
    if (!panel) return;
    const tabs = Array.from(tabset.querySelectorAll("[data-editor-tab]"));
    const views = Array.from(panel.querySelectorAll("[data-editor-view]"));

    const setView = (viewName) => {
      tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.editorTab === viewName));
      views.forEach((view) => view.classList.toggle("is-active", view.dataset.editorView === viewName));
    };

    tabs.forEach((tab) => {
      tab.addEventListener("click", () => setView(tab.dataset.editorTab));
    });

    setView("editor");
  });
}

(async function main() {
  initTabs();
  initEditorTabs();

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

  // Themes (from themes.yaml)
  let themes = [];
  try {
    themes = await loadThemesFromYaml();
  } catch (e) {
    console.error(e);
    // UI will keep CSS defaults; settings will disable selector if themes are missing
  }

  let entries = null;
  let compendiums = null;
  const settingsState = await initSettings({
    user,
    themes,
    themeSelectEl: $("#themeSelect"),
    postNameInputEl: $("#postNameSetting"),
    postNameSaveEl: $("#postNameSave"),
    postNameHintEl: $("#postNameHint"),
    onProfileChange: (nextName) => {
      entries?.setPostName(nextName);
      compendiums?.setPostName(nextName);
    }
  });

  entries = initEntries({ user, postName: settingsState.postName });

  compendiums = initCompendiums({
    user,
    postName: settingsState.postName,
    onSelectCompendium: (scope, compId, compDoc) => {
      entries.setActiveCompendium(scope, compId, compDoc);
    }
  });

  // default route
  setRoute("compendiums");
})();
