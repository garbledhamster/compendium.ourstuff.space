
import {
  state,
  saveStateLocal,
  uid,
  nowISO,
  clamp,
  toLines,
  fromLines,
  uniqueNonEmpty,
  escapeHTML,
  escapeAttr,
  activeCompendium,
  setActiveCompendium,
  shellHTML,
  refreshIcons,
  toast,
  toggleTheme,
  PATHS
} from "./public.js";

import {
  saveCompendiumRemote,
  deleteCompendiumRemote,
  saveEntryRemote
} from "./private.js";

export function isDue(entry) {
  const due = entry?.study?.dueAt ? new Date(entry.study.dueAt).getTime() : 0;
  return due <= Date.now();
}

export function getDueEntries(comp) {
  return Object.values(comp?.entries || {})
    .filter(isDue)
    .sort((a, b) => new Date(a.study?.dueAt || 0) - new Date(b.study?.dueAt || 0));
}

export function newCompendium(user) {
  const id = uid("cmp");
  const c = {
    id,
    name: "Untitled Compendium",
    topic: "",
    scope: "topic",
    audience: "personal",
    template: "parker",
    createdAt: nowISO(),
    updatedAt: nowISO(),
    starterTitles: [],
    categories: [],
    entries: {},
    settings: { studyMode: "due" }
  };
  state.compendiums[id] = c;
  state.activeCompendiumId = id;
  state.wizard.step = 1;
  saveStateLocal();
  saveCompendiumRemote(user, c, { isNew: true });
  return c;
}

export function deleteCompendium(user, id) {
  if (!state.compendiums[id]) return;
  delete state.compendiums[id];
  if (state.activeCompendiumId === id) state.activeCompendiumId = Object.keys(state.compendiums || {})[0] || null;
  saveStateLocal();
  deleteCompendiumRemote(user, id);
}

export function upsertEntry(user, compendiumId, entry) {
  const c = state.compendiums[compendiumId];
  if (!c) return null;

  const id = entry.id || uid("ent");
  const prev = c.entries[id] || null;

  const merged = {
    id,
    title: entry.title || "",
    category: entry.category || "",
    what: entry.what || "",
    keyPoints: entry.keyPoints || [],
    distinctions: entry.distinctions || [],
    examples: entry.examples || [],
    why: entry.why || "",
    understanding: entry.understanding || "",
    sources: entry.sources || [],
    tags: entry.tags || [],
    images: entry.images || prev?.images || [],
    createdAt: prev?.createdAt || nowISO(),
    updatedAt: nowISO(),
    study: prev?.study || {
      intervalDays: 1,
      dueAt: nowISO(),
      lapses: 0,
      lastReviewedAt: null
    }
  };

  c.entries[id] = merged;
  c.updatedAt = nowISO();
  saveStateLocal();
  saveEntryRemote(user, compendiumId, merged, { isNew: !prev });
  saveCompendiumRemote(user, c);
  return { id, isNew: !prev };
}

export function bulkCreateFromStarters(user) {
  const c = activeCompendium();
  if (!c) return 0;
  const titles = uniqueNonEmpty(c.starterTitles || []);
  if (!titles.length) return 0;

  let created = 0;
  for (const t of titles) {
    const exists = Object.values(c.entries || {}).some(e => (e.title || "").trim().toLowerCase() === t.trim().toLowerCase());
    if (exists) continue;
    upsertEntry(user, c.id, {
      title: t,
      category: "",
      what: "",
      keyPoints: [],
      distinctions: [],
      examples: [],
      why: "",
      understanding: "",
      sources: [],
      tags: [],
      images: []
    });
    created++;
  }
  return created;
}

export function generateStarterTitles(topic) {
  const t = (topic || "the topic").trim();
  if (!topic || !topic.trim()) {
    return [
      "Definition (in my words)",
      "Core concepts",
      "Key distinctions",
      "Common misconceptions",
      "Major positions / models",
      "Best arguments (for)",
      "Best arguments (against)",
      "Examples / cases",
      "Applications / why it matters",
      "Mini-glossary"
    ];
  }
  return [
    `Definition of ${t}`,
    `Core concepts in ${t}`,
    `Key distinctions within ${t}`,
    `Common misconceptions about ${t}`,
    `Major positions or models in ${t}`,
    `Strongest arguments for a central claim in ${t}`,
    `Strongest objections / counterarguments in ${t}`,
    `Important examples / case studies in ${t}`,
    `Practical applications / why ${t} matters`,
    `${t} mini-glossary (key terms)`
  ];
}

function renderCompendiumList() {
  const comps = Object.values(state.compendiums || {})
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  if (!comps.length) {
    return `
      <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div class="text-sm font-semibold">No compendiums yet</div>
        <div class="mt-1 text-xs text-slate-400">Create one to start.</div>
        <button type="button" class="mt-3 w-full rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          data-action="new-compendium">
          <span class="inline-flex items-center gap-2"><i data-lucide="plus" class="h-4 w-4"></i>New compendium</span>
        </button>
      </div>
    `;
  }

  return `
    <div class="space-y-2">
      ${comps.map(c => {
        const isActive = c.id === state.activeCompendiumId;
        const badge = `${c.scope === "general" ? "Encyclopedia" : "Topic"} • ${c.audience === "public" ? "Public" : "Personal"}`;
        const topic = c.topic ? escapeHTML(c.topic) : "No topic yet";
        return `
          <div class="rounded-2xl border ${isActive ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/10 bg-white/5"} p-4">
            <div class="flex items-start justify-between gap-2">
              <button type="button" class="min-w-0 flex-1 text-left" data-action="select-compendium" data-id="${escapeAttr(c.id)}">
                <div class="truncate text-sm font-semibold">${escapeHTML(c.name)}</div>
                <div class="truncate text-xs text-slate-300">${topic}</div>
                <div class="mt-1 text-[11px] text-slate-400">${escapeHTML(badge)}</div>
              </button>
              <div class="flex gap-2">
                <a href="${escapeAttr(PATHS.entries)}" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10">
                  <span class="inline-flex items-center gap-2"><i data-lucide="list" class="h-4 w-4"></i>Entries</span>
                </a>
                <button type="button" class="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-500/20"
                  data-action="delete-compendium" data-id="${escapeAttr(c.id)}">
                  <span class="inline-flex items-center gap-2"><i data-lucide="trash-2" class="h-4 w-4"></i>Delete</span>
                </button>
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderWizard(c) {
  const step = clamp(state.wizard?.step ?? 1, 1, 3);
  const progressPct = (step / 3) * 100;

  const stepBtns = `
    <div class="flex gap-2">
      <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
        data-action="wizard-back" ${step === 1 ? "disabled" : ""}>
        Back
      </button>
      <button type="button" class="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
        data-action="wizard-next">
        ${step < 3 ? "Next" : "Finish"}
      </button>
    </div>
  `;

  const progress = `
    <div class="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
      <div class="flex items-center justify-between text-xs">
        <div class="font-semibold text-slate-300">Progress</div>
        <div class="text-slate-400">Step ${step} / 3</div>
      </div>
      <div class="mt-2 h-2 rounded-full bg-white/10">
        <div class="h-2 rounded-full bg-cyan-400/70" style="width:${progressPct}%"></div>
      </div>
    </div>
  `;

  const content = step === 1 ? wizardStep1(c) : step === 2 ? wizardStep2(c) : wizardStep3(c);

  return `
    <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div class="text-sm font-semibold">Builder</div>
          <div class="mt-1 text-xs text-slate-400">Run once. Then just add entries.</div>
        </div>
        ${stepBtns}
      </div>
      ${progress}
      <div class="mt-4">${content}</div>
    </div>
  `;
}

function wizardStep1(c) {
  const pill = (field, value, title, sub, active) => `
    <button type="button" class="rounded-xl border ${active ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/10 bg-white/5"} p-3 text-left hover:bg-white/10"
      data-action="set-type" data-field="${escapeAttr(field)}" data-value="${escapeAttr(value)}">
      <div class="text-sm font-semibold">${escapeHTML(title)}</div>
      <div class="text-xs text-slate-400">${escapeHTML(sub)}</div>
    </button>
  `;

  return `
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
        <div class="text-sm font-semibold">Name + topic</div>
        <div class="mt-4 grid gap-3">
          <label class="block">
            <div class="mb-1 text-xs font-semibold text-slate-300">Compendium name</div>
            <input class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
              value="${escapeAttr(c.name)}" data-action="edit-compendium" data-field="name" />
          </label>
          <label class="block">
            <div class="mb-1 text-xs font-semibold text-slate-300">Topic (recommended)</div>
            <input class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
              value="${escapeAttr(c.topic)}" data-action="edit-compendium" data-field="topic" />
          </label>
        </div>
      </div>

      <div class="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
        <div class="text-sm font-semibold">Type</div>

        <div class="mt-3 rounded-2xl border border-white/10 bg-black/10 p-4">
          <div class="text-xs font-semibold text-slate-300">Scope</div>
          <div class="mt-2 grid grid-cols-2 gap-2">
            ${pill("scope", "topic", "Topic-specific", "Best for mastery", c.scope === "topic")}
            ${pill("scope", "general", "General (encyclopedia)", "Many topics", c.scope === "general")}
          </div>
        </div>

        <div class="mt-3 rounded-2xl border border-white/10 bg-black/10 p-4">
          <div class="text-xs font-semibold text-slate-300">Audience</div>
          <div class="mt-2 grid grid-cols-2 gap-2">
            ${pill("audience", "personal", "Personal", "Just for you", c.audience === "personal")}
            ${pill("audience", "public", "Public/communal", "Share/publish", c.audience === "public")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function wizardStep2(c) {
  const previews = {
    parker: {
      title: "Classic Compendium (Parker-style)",
      desc: "Concise info + analysis in your own words.",
      fields: ["What it is", "Key points", "Distinctions", "Examples", "Why it matters", "My understanding", "Sources", "Tags", "Images"]
    },
    onepage: {
      title: "One-page-per-concept",
      desc: "Forces compression and clarity.",
      fields: ["Definition", "3–7 bullets", "One example", "One contrast", "One takeaway", "Sources", "Tags", "Images"]
    },
    fieldguide: {
      title: "Field-guide feel",
      desc: "Best for reference topics: species, tools, procedures.",
      fields: ["Identification/What", "Key traits", "Similar items", "Range/Context", "Use cases", "Sources", "Tags", "Images"]
    }
  };

  const templateCard = (key, current, meta) => {
    const active = key === current;
    return `
      <button type="button" class="rounded-2xl border ${active ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/10 bg-white/5"} p-4 text-left hover:bg-white/10"
        data-action="set-template" data-template="${escapeAttr(key)}">
        <div class="flex items-start justify-between gap-2">
          <div>
            <div class="text-sm font-semibold">${escapeHTML(meta.title)}</div>
            <div class="mt-1 text-xs text-slate-400">${escapeHTML(meta.desc)}</div>
          </div>
          <div class="mt-0.5 ${active ? "text-cyan-200" : "text-slate-400"}">
            <i data-lucide="${active ? "check-circle-2" : "circle"}" class="h-5 w-5"></i>
          </div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          ${meta.fields.map(f => `<span class="rounded-full border border-white/10 bg-slate-950/30 px-2 py-1 text-[11px] text-slate-300">${escapeHTML(f)}</span>`).join("")}
        </div>
      </button>
    `;
  };

  const cats = (c.categories?.length ? c.categories : ["Definitions", "Distinctions", "Arguments", "Examples", "Glossary"]);

  return `
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
        <div class="text-sm font-semibold">Template</div>
        <div class="mt-3 grid gap-3">
          ${templateCard("parker", c.template, previews.parker)}
          ${templateCard("onepage", c.template, previews.onepage)}
          ${templateCard("fieldguide", c.template, previews.fieldguide)}
        </div>
      </div>

      <div class="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
        <div class="text-sm font-semibold">Starter categories</div>
        <div class="mt-3 flex gap-2">
          <input id="newCategoryInput"
            class="flex-1 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
            placeholder="Add a category" />
          <button type="button" class="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
            data-action="add-category">
            Add
          </button>
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          ${cats.map(cat => `
            <span class="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs">
              ${escapeHTML(cat)}
              <button type="button" class="text-slate-300 hover:text-rose-200" data-action="remove-category" data-cat="${escapeAttr(cat)}">
                <i data-lucide="x" class="h-3 w-3"></i>
              </button>
            </span>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function wizardStep3(c) {
  const titles = c.starterTitles?.length ? c.starterTitles : [];
  const hint = c.topic ? `for “${escapeHTML(c.topic)}”` : "for your topic";

  return `
    <div class="grid gap-4 lg:grid-cols-2">
      <div class="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
        <div class="text-sm font-semibold">Starter index</div>
        <div class="mt-1 text-xs text-slate-400">Create 10 starter titles ${hint}.</div>

        <div class="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" class="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
            data-action="generate-starters">
            <span class="inline-flex items-center gap-2"><i data-lucide="sparkles" class="h-4 w-4"></i>Generate 10</span>
          </button>
          <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
            data-action="clear-starters">
            Clear
          </button>
        </div>

        <div class="mt-4">
          <div class="text-xs font-semibold text-slate-300">One per line</div>
          <textarea id="starterTitlesBox" rows="12"
            class="mt-2 w-full rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-3 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
          >${escapeHTML(fromLines(titles))}</textarea>

          <button type="button" class="mt-3 w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
            data-action="save-starters">
            Save titles
          </button>
        </div>
      </div>

      <div class="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
        <div class="text-sm font-semibold">Finish</div>
        <div class="mt-1 text-xs text-slate-400">Finish creates placeholder entries from the titles.</div>

        <div class="mt-4 rounded-2xl border border-white/10 bg-black/10 p-4">
          <div class="text-xs font-semibold text-slate-300">Next</div>
          <div class="mt-1 text-xs text-slate-400">Go to Entries and fill one placeholder per day.</div>
          <a href="${escapeAttr(PATHS.entries)}" class="mt-3 inline-flex rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
            <span class="inline-flex items-center gap-2"><i data-lucide="list" class="h-4 w-4"></i>Go to Entries</span>
          </a>
        </div>
      </div>
    </div>
  `;
}

function pageBodyHTML() {
  const c = activeCompendium();
  const list = renderCompendiumList();

  const wizardBlock = c ? renderWizard(c) : `
    <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div class="text-sm font-semibold">Create a compendium</div>
      <div class="mt-1 text-xs text-slate-400">Start here, then go to Entries.</div>
    </div>
  `;

  return `
    <div class="grid gap-4">
      <div class="flex flex-wrap gap-2">
        <button type="button" class="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          data-action="new-compendium">
          <span class="inline-flex items-center gap-2"><i data-lucide="plus" class="h-4 w-4"></i>New compendium</span>
        </button>
        <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
          data-action="toggle-theme">
          <span class="inline-flex items-center gap-2"><i data-lucide="moon" class="h-4 w-4"></i>Theme</span>
        </button>
      </div>

      ${list}
      ${wizardBlock}
    </div>
  `;
}

export function mountCompendiumPage(appEl, user) {
  const rightHTML = `
    <a href="${escapeAttr(PATHS.entries)}" class="hidden sm:inline-flex rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10">
      <span class="inline-flex items-center gap-2"><i data-lucide="list" class="h-4 w-4"></i>Entries</span>
    </a>
    <a href="${escapeAttr(PATHS.settings)}" class="hidden sm:inline-flex rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10">
      <span class="inline-flex items-center gap-2"><i data-lucide="settings" class="h-4 w-4"></i>Settings</span>
    </a>
  `;

  appEl.innerHTML = shellHTML({
    title: "Compendium Builder",
    subtitle: "Create, select, and build compendiums",
    rightHTML,
    bodyHTML: pageBodyHTML(),
    activeNav: "compendium"
  });

  refreshIcons();

  const rerender = () => {
    appEl.innerHTML = shellHTML({
      title: "Compendium Builder",
      subtitle: "Create, select, and build compendiums",
      rightHTML,
      bodyHTML: pageBodyHTML(),
      activeNav: "compendium"
    });
    refreshIcons();
  };

  appEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const c = activeCompendium();

    if (action === "toggle-theme") {
      toggleTheme();
      return;
    }

    if (action === "new-compendium") {
      newCompendium(user);
      rerender();
      return;
    }

    if (action === "select-compendium") {
      setActiveCompendium(btn.dataset.id);
      rerender();
      return;
    }

    if (action === "delete-compendium") {
      const id = btn.dataset.id;
      const name = state.compendiums[id]?.name || "this compendium";
      if (confirm(`Delete “${name}”? This can’t be undone.`)) {
        deleteCompendium(user, id);
        rerender();
      }
      return;
    }

    if (!c) return;

    if (action === "wizard-next") {
      state.wizard.step = clamp((state.wizard.step || 1) + 1, 1, 3);
      if (state.wizard.step === 3 && (btn.textContent || "").trim() === "Finish") state.wizard.step = 3;
      saveStateLocal();
      rerender();
      return;
    }

    if (action === "wizard-back") {
      state.wizard.step = clamp((state.wizard.step || 1) - 1, 1, 3);
      saveStateLocal();
      rerender();
      return;
    }

    if (action === "set-type") {
      c[btn.dataset.field] = btn.dataset.value;
      c.updatedAt = nowISO();
      saveStateLocal();
      saveCompendiumRemote(user, c);
      rerender();
      return;
    }

    if (action === "set-template") {
      c.template = btn.dataset.template;
      c.updatedAt = nowISO();
      saveStateLocal();
      saveCompendiumRemote(user, c);
      rerender();
      return;
    }

    if (action === "add-category") {
      const input = document.getElementById("newCategoryInput");
      const v = (input?.value || "").trim();
      if (!v) return;
      c.categories = uniqueNonEmpty([...(c.categories || []), v]);
      c.updatedAt = nowISO();
      saveStateLocal();
      saveCompendiumRemote(user, c);
      if (input) input.value = "";
      rerender();
      return;
    }

    if (action === "remove-category") {
      const cat = btn.dataset.cat;
      c.categories = (c.categories || []).filter(x => x !== cat);
      c.updatedAt = nowISO();
      saveStateLocal();
      saveCompendiumRemote(user, c);
      rerender();
      return;
    }

    if (action === "generate-starters") {
      c.starterTitles = generateStarterTitles(c.topic);
      c.updatedAt = nowISO();
      saveStateLocal();
      saveCompendiumRemote(user, c);
      toast("Starter titles generated.", "ok");
      rerender();
      return;
    }

    if (action === "clear-starters") {
      c.starterTitles = [];
      c.updatedAt = nowISO();
      saveStateLocal();
      saveCompendiumRemote(user, c);
      rerender();
      return;
    }

    if (action === "save-starters") {
      const box = document.getElementById("starterTitlesBox");
      const titles = uniqueNonEmpty(toLines(box?.value || ""));
      c.starterTitles = titles;
      c.updatedAt = nowISO();
      saveStateLocal();
      saveCompendiumRemote(user, c);
      toast("Starter titles saved.", "ok");
      rerender();
      return;
    }

    if (action === "wizard-next" && (state.wizard.step || 1) === 3) return;

    if (action === "wizard-next" && (btn.textContent || "").trim() === "Finish") return;

    if (action === "wizard-next") return;

    if (action === "wizard-finish") return;
  });

  appEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-action='wizard-next']");
    if (!btn) return;
    const c = activeCompendium();
    if (!c) return;
    if ((state.wizard.step || 1) < 3) return;
    const created = bulkCreateFromStarters(user);
    toast(created ? `Created ${created} placeholder entries.` : "No new placeholders created.", "ok");
    window.location.href = PATHS.entries;
  }, { capture: true });

  appEl.addEventListener("input", (ev) => {
    const el = ev.target.closest("[data-action='edit-compendium']");
    if (!el) return;
    const c = activeCompendium();
    if (!c) return;
    c[el.dataset.field] = el.value;
    c.updatedAt = nowISO();
    saveStateLocal();
    saveCompendiumRemote(user, c);
  });
}
