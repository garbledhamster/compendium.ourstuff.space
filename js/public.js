export const STORAGE_KEY = "compendium_builder_v1";
export const THEME_KEY = "compendium_builder_theme_v1";

export let PATHS = {
  login: "pages/login.html",
  entries: "menu/entries.html",
  compendium: "menu/compendium.html",
  settings: "menu/settings.html"
};

export function setPaths(next) {
  PATHS = { ...PATHS, ...next };
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const uid = (p = "id") => `${p}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
export const nowISO = () => new Date().toISOString();
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export const toLines = (s) => String(s || "").split(/\r?\n/).map(x => x.trim()).filter(Boolean);
export const fromLines = (arr) => (arr || []).join("\n");

export function safeJSONParse(raw, fallback) {
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function escapeHTML(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
export const escapeAttr = escapeHTML;

export function uniqueNonEmpty(arr) {
  return Array.from(new Set((arr || []).map(x => String(x || "").trim()).filter(Boolean)));
}

export function normalizeTimestamp(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return value;
}

export function generateSalt(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, "0")).join("");
}

export function defaultState() {
  return {
    version: 1,
    activeCompendiumId: null,
    view: "entries",
    wizard: { step: 1 },
    compendiums: {}
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return defaultState();
  const st = safeJSONParse(raw, null);
  if (!st || typeof st !== "object") return defaultState();
  if (!st.version) st.version = 1;
  if (!st.compendiums) st.compendiums = {};
  if (!st.wizard) st.wizard = { step: 1 };
  if (!st.view) st.view = "entries";
  return st;
}

export const state = loadState();

export function saveStateLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function replaceState(next) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, next);
  saveStateLocal();
}

export function activeCompendium() {
  return state.activeCompendiumId ? state.compendiums[state.activeCompendiumId] : null;
}

export function setActiveCompendium(id) {
  state.activeCompendiumId = id || null;
  saveStateLocal();
}

export function loadTheme() {
  const t = localStorage.getItem(THEME_KEY);
  if (t === "light") return "light";
  if (t === "dark") return "dark";
  return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  document.body.classList.toggle("bg-slate-950", isDark);
  document.body.classList.toggle("text-slate-100", isDark);
  document.body.classList.toggle("bg-slate-50", !isDark);
  document.body.classList.toggle("text-slate-900", !isDark);
}

export function toggleTheme() {
  const next = (loadTheme() === "dark") ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
  toast(`Theme: ${next}`, "ok");
  return next;
}

export function refreshIcons() {
  try { window.lucide?.createIcons?.(); } catch {}
}

let toastTimer = null;
export function toast(msg, tone = "ok") {
  clearTimeout(toastTimer);
  let el = $("#toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  const toneCls = tone === "error" ? "text-rose-200 border-rose-500/25" : "text-slate-100 border-white/10";
  el.className = `fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-xl border bg-slate-950/80 px-4 py-2 text-sm shadow-soft backdrop-blur ${toneCls}`;
  el.textContent = msg;
  el.style.opacity = "1";
  toastTimer = setTimeout(() => { el.style.opacity = "0"; }, 2400);
}

export function navHTML(activeKey) {
  const item = (key, href, icon, label) => {
    const active = key === activeKey;
    const cls = active ? "text-cyan-200" : "text-slate-200";
    return `
      <a href="${escapeAttr(href)}" class="flex flex-col items-center gap-1 text-xs font-semibold ${cls}">
        <i data-lucide="${escapeAttr(icon)}" class="h-5 w-5"></i>
        ${escapeHTML(label)}
      </a>
    `;
  };

  return `
    <nav class="app-fixed fixed bottom-0 z-40 border-t border-white/10 bg-slate-950/90 backdrop-blur lg:hidden">
      <div class="mx-auto flex items-center justify-around px-3 py-3">
        ${item("compendium", PATHS.compendium, "layout-list", "Compendiums")}
        ${item("entries", PATHS.entries, "list", "Entries")}
        ${item("settings", PATHS.settings, "settings", "Settings")}
      </div>
    </nav>
  `;
}

export function shellHTML({ title, subtitle, rightHTML = "", bodyHTML = "", activeNav = "entries" }) {
  return `
    <div class="app-bg"></div>
    <div class="fixed inset-0 -z-10 noise opacity-[0.35]"></div>

    <div class="app-shell px-4 py-6 sm:px-6 lg:px-8">
      <header class="rounded-2xl border border-white/10 bg-white/5 shadow-glow backdrop-blur px-4 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <div class="grid h-10 w-10 place-items-center rounded-xl bg-white/10 shrink-0">
              <i data-lucide="book-open" class="h-5 w-5"></i>
            </div>
            <div class="min-w-0">
              <div class="text-sm font-semibold leading-tight truncate">${escapeHTML(title)}</div>
              <div class="text-xs text-slate-300 truncate">${escapeHTML(subtitle)}</div>
            </div>
          </div>
          <div class="shrink-0 flex items-center gap-2">${rightHTML}</div>
        </div>
      </header>

      <main class="pb-24 pt-4">
        ${bodyHTML}
      </main>
    </div>

    ${navHTML(activeNav)}
  `;
}

export function exportJSONDownload() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `compendium-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function resetLocalOnly() {
  localStorage.removeItem(STORAGE_KEY);
  replaceState(defaultState());
}

