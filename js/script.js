
import {
  setPaths,
  PATHS,
  loadTheme,
  applyTheme,
  shellHTML,
  refreshIcons,
  toast,
  safeJSONParse,
  replaceState,
  state,
  exportJSONDownload,
  resetLocalOnly,
  escapeAttr
} from "./public.js";

import { watchAuth, createAccount, signIn, logout } from "./authentication.js";
import { loadUserData, syncRemoteFromLocal } from "./private.js";
import { mountEntriesPage } from "./entries.js";
import { mountCompendiumPage } from "./compendium.js";

function detectPaths() {
  const p = window.location.pathname || "";
  if (p.includes("/menu/")) {
    setPaths({
      entries: "./entries.html",
      compendium: "./compendium.html",
      settings: "./settings.html",
      login: "../pages/login.html"
    });
    return;
  }
  if (p.includes("/pages/")) {
    setPaths({
      entries: "../menu/entries.html",
      compendium: "../menu/compendium.html",
      settings: "../menu/settings.html",
      login: "./login.html"
    });
    return;
  }
  setPaths({
    entries: "./menu/entries.html",
    compendium: "./menu/compendium.html",
    settings: "./menu/settings.html",
    login: "./pages/login.html"
  });
}

detectPaths();
applyTheme(loadTheme());

const app = document.getElementById("app");

function go(href) {
  window.location.replace(href);
}

function mountLoginPage() {
  app.innerHTML = `
    <div class="app-bg"></div>
    <div class="fixed inset-0 -z-10 noise opacity-[0.35]"></div>

    <div class="min-h-full grid place-items-center px-4 py-10">
      <div class="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 shadow-glow backdrop-blur">
        <div class="flex items-center gap-3">
          <div class="grid h-12 w-12 place-items-center rounded-2xl bg-white/10">
            <i data-lucide="book-open" class="h-6 w-6"></i>
          </div>
          <div>
            <div class="text-lg font-semibold">Compendium Builder</div>
            <div class="text-xs text-slate-300">Sign in to sync your library.</div>
          </div>
        </div>

        <div class="mt-6 space-y-4">
          <label class="block">
            <span class="mb-1 block text-xs font-semibold text-slate-300">Email</span>
            <input id="authEmail" type="email" autocomplete="email"
              class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20" />
          </label>

          <label class="block">
            <span class="mb-1 block text-xs font-semibold text-slate-300">Password</span>
            <input id="authPassword" type="password" autocomplete="current-password"
              class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20" />
          </label>

          <div id="authError" class="hidden rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200"></div>

          <div class="grid gap-3 sm:grid-cols-2">
            <button id="createAccountBtn" type="button"
              class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10">
              Create account
            </button>
            <button id="signInBtn" type="button"
              class="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
              Sign in
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  refreshIcons();

  const setErr = (msg) => {
    const el = document.getElementById("authError");
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
  };

  document.getElementById("createAccountBtn").addEventListener("click", async () => {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value || "";
    if (!password) { setErr("Password is required to create an account."); return; }
    try { setErr(""); await createAccount(email, password); } catch (e) { setErr(e?.message || "Unable to create account."); }
  });

  document.getElementById("signInBtn").addEventListener("click", async () => {
    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value || "";
    if (!email || !password) { setErr("Enter both email and password to sign in."); return; }
    try { setErr(""); await signIn(email, password); } catch (e) { setErr(e?.message || "Unable to sign in."); }
  });
}

function mountSettingsPage(user) {
  const rightHTML = `
    <button type="button" class="hidden sm:inline-flex rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10"
      data-action="toggle-theme">
      <span class="inline-flex items-center gap-2"><i data-lucide="moon" class="h-4 w-4"></i>Theme</span>
    </button>
  `;

  const bodyHTML = `
    <div class="grid gap-4">
      <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div class="text-sm font-semibold">Export</div>
        <div class="mt-1 text-xs text-slate-400">Download a JSON backup of all compendiums.</div>
        <button type="button" class="mt-3 w-full rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          data-action="export-json">
          Export JSON
        </button>
      </div>

      <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div class="text-sm font-semibold">Import</div>
        <div class="mt-1 text-xs text-slate-400">Restore from a JSON backup.</div>
        <input id="importFile" type="file" accept="application/json"
          class="mt-3 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm" />
        <button type="button" class="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
          data-action="import-json">
          Import JSON
        </button>
      </div>

      <div class="rounded-2xl border border-rose-500/25 bg-rose-500/10 p-5">
        <div class="text-sm font-semibold text-rose-100">Danger zone</div>
        <div class="mt-1 text-xs text-rose-200/80">Clears local cache for this browser. Cloud data stays intact.</div>
        <button type="button" class="mt-3 w-full rounded-xl bg-rose-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-rose-400"
          data-action="reset-local">
          Reset local data
        </button>
      </div>

      <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div class="text-sm font-semibold">Account</div>
        <div class="mt-1 text-xs text-slate-400">Sign out of this device.</div>
        <button type="button" class="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
          data-action="logout">
          Log out
        </button>
      </div>
    </div>
  `;

  app.innerHTML = shellHTML({
    title: "Compendium Builder",
    subtitle: "Export, import, and device settings",
    rightHTML,
    bodyHTML,
    activeNav: "settings"
  });

  refreshIcons();

  app.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "toggle-theme") { import("./public.js").then(m => m.toggleTheme()); return; }
    if (action === "export-json") { exportJSONDownload(); return; }

    if (action === "import-json") {
      const file = document.getElementById("importFile")?.files?.[0];
      if (!file) { toast("Choose a JSON file first.", "error"); return; }
      try {
        const text = await file.text();
        const parsed = safeJSONParse(text, null);
        if (!parsed || typeof parsed !== "object" || !parsed.compendiums) { toast("Invalid JSON backup.", "error"); return; }
        replaceState(parsed);
        await syncRemoteFromLocal(user, state.compendiums);
        toast("Imported backup.", "ok");
        go(PATHS.entries);
      } catch {
        toast("Import failed.", "error");
      }
      return;
    }

    if (action === "reset-local") {
      if (confirm("Reset all local data? This cannot be undone.")) {
        resetLocalOnly();
        toast("Local data cleared.", "ok");
      }
      return;
    }

    if (action === "logout") {
      await logout();
      go(PATHS.login);
      return;
    }
  }, { once: true });
}

function pageKind() {
  const p = window.location.pathname || "";
  if (p.endsWith("/pages/login.html")) return "login";
  if (p.endsWith("/menu/entries.html")) return "entries";
  if (p.endsWith("/menu/compendium.html")) return "compendium";
  if (p.endsWith("/menu/settings.html")) return "settings";
  return "root";
}

const kind = pageKind();

watchAuth(async (user) => {
  if (kind === "login") {
    mountLoginPage();
    if (user) {
      await loadUserData(user);
      go(PATHS.entries);
    }
    return;
  }

  if (kind === "root") {
    if (user) {
      await loadUserData(user);
      go(PATHS.entries);
    } else {
      go(PATHS.login);
    }
    return;
  }

  if (!user) {
    go(PATHS.login);
    return;
  }

  await loadUserData(user);

  if (kind === "entries") {
    mountEntriesPage(app, user);
    return;
  }

  if (kind === "compendium") {
    mountCompendiumPage(app, user);
    return;
  }

  if (kind === "settings") {
    mountSettingsPage(user);
    return;
  }

  go(PATHS.entries);
});
