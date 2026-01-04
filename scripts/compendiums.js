import {
  listenPersonalCompendiums,
  listenPublicCompendiums,
  listenEntriesByUserAccess,
  createCompendium,
  updateCompendium,
  deleteCompendium,
  addCompendiumEditor,
  removeCompendiumEditor
} from "./firebase.js";

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

function esc(s){ return (s ?? "").toString(); }
function normEmail(e){ return (e || "").trim().toLowerCase(); }
function isValidEmail(e){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }
function parseTags(raw){ return (raw || "").split(",").map(x => x.trim()).filter(Boolean).slice(0, 40); }

function toast(msg, kind="ok") {
  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-on"));
  setTimeout(() => { el.classList.remove("is-on"); setTimeout(() => el.remove(), 220); }, 2200);
}

function stableSeed() {
  // Stable-enough random seed for covers (stored in doc)
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function coverUrlFor(comp) {
  if (comp?.coverUrl) return comp.coverUrl;
  const seed = comp?.coverSeed || comp?.id || "compendium";
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/900/650`;
}

function isOwner(user, comp){ return comp?.ownerUid === user.uid; }
function isEditor(user, comp){
  if (!comp || comp.visibility !== "public") return false;
  const emails = Array.isArray(comp.editorEmails) ? comp.editorEmails : [];
  return emails.includes(normEmail(user.email || ""));
}
function canEditCompendium(user, comp){
  if (!comp) return false;
  if (comp.visibility === "personal") return isOwner(user, comp);
  return isOwner(user, comp) || isEditor(user, comp);
}
function canManageEditors(user, comp){
  return comp?.visibility === "public" && isOwner(user, comp);
}

function canAccessCompendium(user, comp) {
  if (!comp) return false;
  const visibility = comp.visibility;
  const owner = isOwner(user, comp);
  const editor = isEditor(user, comp);
  const editable = canEditCompendium(user, comp);
  return visibility === "public" || owner || editor || editable;
}

function fmtCount(n, label) {
  return `${n} ${label}${n === 1 ? "" : "s"}`;
}

export function initCompendiums({ user, onSelectCompendium }) {
  const goToRoute = (route) => {
    document.dispatchEvent(new CustomEvent("app:route", { detail: { route } }));
  };

  // --- DOM ---
  const personal = {
    panel: $("#personalEditorPanel"),
    editorEmpty: $("#personalEditorEmpty"),
    form: $("#personalCompendiumForm"),
    title: $("#personalEditorTitle"),
    subtitle: $("#personalEditorSubtitle"),
    ownerLine: $("#personalOwnerLine"),
    typePill: $("#personalTypePill"),

    name: $("#personalCompName"),
    topic: $("#personalCompTopic"),
    desc: $("#personalCompDesc"),
    tags: $("#personalCompTags"),

    btnSave: $("#btnSavePersonalCompendium"),
    btnDelete: $("#btnDeleteCompendium")
  };

  const pub = {
    panel: $("#publicEditorPanel"),
    editorEmpty: $("#publicEditorEmpty"),
    form: $("#publicCompendiumForm"),
    title: $("#publicEditorTitle"),
    subtitle: $("#publicEditorSubtitle"),
    ownerLine: $("#publicOwnerLine"),
    typePill: $("#publicTypePill"),

    name: $("#publicCompName"),
    topic: $("#publicCompTopic"),
    desc: $("#publicCompDesc"),
    tags: $("#publicCompTags"),

    editHint: $("#publicEditHint"),
    btnSave: $("#btnSavePublicCompendium"),
    btnDelete: $("#btnDeletePublicCompendium"),

    editorsSection: $("#editorsSection"),
    editorInput: $("#editorEmailInput"),
    btnAddEditor: $("#btnAddEditor"),
    editorChips: $("#editorChips")
  };

  // Modal
  const modal = {
    dlg: $("#newCompModal"),
    err: $("#newCompError"),
    name: $("#newCompName"),
    topic: $("#newCompTopic"),
    desc: $("#newCompDesc"),
    tags: $("#newCompTags"),
    btnCreate: $("#btnCreateComp")
  };

  const listView = {
    list: $("#compendiumList"),
    count: $("#compendiumCount"),
    search: $("#compendiumSearch"),
    visibility: $("#compendiumVisibility"),
    sort: $("#compendiumSort"),
    viewMode: $("#compendiumViewMode")
  };

  const linksView = {
    personalCompendiums: $("#personalLinksCompendiums"),
    personalEntries: $("#personalLinksEntries"),
    publicCompendiums: $("#publicLinksCompendiums"),
    publicEntries: $("#publicLinksEntries")
  };

  // --- State ---
  let personalUnsub = null;
  let publicUnsub = null;
  let entriesUnsub = null;

  let personalItems = [];
  let publicItems = [];
  let entryItems = [];

  let selectedCompendium = null;
  let selectedScope = "personal";
  let filterState = {
    search: "",
    visibility: "all",
    sort: "recent",
    viewMode: "book"
  };

  if (listView.viewMode) {
    filterState.viewMode = listView.viewMode.value || "book";
  }

  // --- Events ---
  $("#btnNewCompendium").addEventListener("click", () => {
    modal.err.classList.add("is-hidden");
    modal.err.textContent = "";
    modal.name.value = "";
    modal.topic.value = "";
    modal.desc.value = "";
    modal.tags.value = "";
    // default radio already checked in HTML
    modal.dlg.showModal?.();
  });

  modal.btnCreate.addEventListener("click", createFromModal);

  personal.btnSave.addEventListener("click", () => saveCompendium("personal"));
  personal.btnDelete.addEventListener("click", () => removeCompendium("personal"));

  pub.btnSave.addEventListener("click", () => saveCompendium("public"));
  pub.btnDelete.addEventListener("click", () => removeCompendium("public"));

  $("#btnRefreshPublic").addEventListener("click", () => {
    publicUnsub?.();
    publicUnsub = null;
    listenPublic();
    toast("Refreshed");
  });

  pub.btnAddEditor.addEventListener("click", () => addEditor());

  $$('[data-action="back-to-compendiums"]').forEach((btn) => {
    btn.addEventListener("click", () => goToRoute("compendiums"));
  });

  listView.search.addEventListener("input", () => {
    filterState.search = listView.search.value.trim().toLowerCase();
    renderCombinedList();
  });

  listView.visibility.addEventListener("change", () => {
    filterState.visibility = listView.visibility.value;
    renderCombinedList();
  });

  listView.sort.addEventListener("change", () => {
    filterState.sort = listView.sort.value;
    renderCombinedList();
  });

  listView.viewMode.addEventListener("change", () => {
    filterState.viewMode = listView.viewMode.value;
    renderCombinedList();
  });

  // --- Listen ---
  listenPersonal();
  listenPublic();
  listenEntriesAccess();

  function listenPersonal() {
    personalUnsub?.();
    personalUnsub = listenPersonalCompendiums(user.uid, (items) => {
      personalItems = items.map(item => normalizeCompendium(item, "personal"));
      syncSelected();
      renderCombinedList();
      renderLinks();
    }, (err) => {
      console.error(err);
      toast(err?.message || "Failed to load personal compendiums", "bad");
    });
  }

  function listenPublic() {
    publicUnsub?.();
    publicUnsub = listenPublicCompendiums((items) => {
      publicItems = items.map(item => normalizeCompendium(item, "public"));
      syncSelected();
      renderCombinedList();
      renderLinks();
    }, (err) => {
      console.error(err);
      toast(err?.message || "Failed to load public compendiums", "bad");
    });
  }

  function listenEntriesAccess() {
    entriesUnsub?.();
    entriesUnsub = listenEntriesByUserAccess(user.uid, (items) => {
      entryItems = items;
      renderLinks();
    }, (err) => {
      console.error(err);
      toast(err?.message || "Failed to load link entries", "bad");
    });
  }

  function normalizeCompendium(item, fallbackVisibility) {
    return {
      ...item,
      visibility: item.visibility || fallbackVisibility
    };
  }

  function syncSelected() {
    if (!selectedCompendium) {
      showDetailPanel(selectedScope);
      paintEditor(selectedScope);
      return;
    }
    const scope = selectedCompendium.doc?.visibility;
    const allItems = [...personalItems, ...publicItems];
    const found = allItems.find(item => item.id === selectedCompendium.id && item.visibility === scope);
    if (found) {
      selectedCompendium = { id: found.id, doc: found };
      showDetailPanel(scope);
      paintEditor(scope);
      onSelectCompendium?.(scope, found.id, found);
    } else {
      selectedCompendium = null;
      showDetailPanel(selectedScope);
      paintEditor(selectedScope);
      onSelectCompendium?.(selectedScope, null, null);
    }
  }

  function renderCombinedList() {
    const allItems = [...personalItems, ...publicItems];
    const filteredItems = filterCompendiums(allItems);
    listView.count.textContent = fmtCount(filteredItems.length, "compendium");
    renderPicker(listView.list, filteredItems, allItems.length, filterState.viewMode);
  }

  function renderLinks() {
    const allCompendiums = [...personalItems, ...publicItems];
    renderLinksForScope(linksView.personalCompendiums, linksView.personalEntries, allCompendiums);
    renderLinksForScope(linksView.publicCompendiums, linksView.publicEntries, allCompendiums);
  }

  function renderLinksForScope(compendiumRoot, entryRoot, allCompendiums) {
    if (!compendiumRoot || !entryRoot) return;

    const byId = new Map(allCompendiums.map(item => [item.id, item]));
    const sortedCompendiums = [...allCompendiums].sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    renderLinkList(compendiumRoot, sortedCompendiums, (comp) => {
      const accessible = canAccessCompendium(user, comp);
      return {
        label: comp.name || "Untitled",
        meta: comp.topic || (comp.visibility === "public" ? "Public compendium" : "Personal compendium"),
        accessible,
        active: selectedCompendium?.id === comp.id && selectedCompendium?.doc?.visibility === comp.visibility,
        onClick: () => selectCompendium(comp, { navigate: true })
      };
    });

    const sortedEntries = [...entryItems].sort((a, b) => entryTimestamp(b) - entryTimestamp(a));
    renderLinkList(entryRoot, sortedEntries, (entry) => {
      const comp = byId.get(entry.compendiumId);
      const accessible = comp ? canAccessCompendium(user, comp) : false;
      const compName = comp?.name || "Unknown compendium";
      return {
        label: entry.title || "Untitled entry",
        meta: compName,
        accessible,
        active: false,
        onClick: () => {
          if (!comp) return;
          selectCompendium(comp, { navigate: true });
        }
      };
    });
  }

  function renderLinkList(root, items, build) {
    root.innerHTML = "";

    if (!items.length) {
      const d = document.createElement("div");
      d.className = "subtle";
      d.textContent = "Nothing to show yet.";
      root.appendChild(d);
      return;
    }

    for (const item of items) {
      const { label, meta, accessible, active, onClick } = build(item);
      const li = document.createElement("li");
      li.className = `links-item${accessible ? "" : " is-muted"}`;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `links-link ${accessible ? "link--active" : "link--muted"}${active ? " is-active" : ""}`;
      btn.textContent = label;
      btn.disabled = !accessible;
      btn.addEventListener("click", onClick);

      const metaEl = document.createElement("div");
      metaEl.className = "links-meta";
      metaEl.textContent = meta;

      li.appendChild(btn);
      li.appendChild(metaEl);
      root.appendChild(li);
    }
  }

  function renderPicker(root, items, totalCount, viewMode) {
    root.innerHTML = "";
    root.classList.toggle("picker-grid--list", viewMode === "list");

    if (!items.length) {
      const d = document.createElement("div");
      d.className = "subtle";
      d.textContent = totalCount === 0
        ? "No compendiums yet — click New to create one."
        : "No compendiums match your filters.";
      root.appendChild(d);
      return;
    }

    for (const c of items) {
      const isActive = selectedCompendium?.id === c.id && selectedCompendium?.doc?.visibility === c.visibility;
      const cover = coverUrlFor(c);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `cp-card${viewMode === "list" ? " cp-card--list" : ""}${isActive ? " is-active" : ""}`;
      if (viewMode !== "list") {
        btn.style.setProperty("--cp-bg", `url("${cover}")`);
      }

      const desc = (c.description || "").trim() || "No description yet.";
      const topic = (c.topic || "").trim();

      if (viewMode === "list") {
        btn.innerHTML = `
          <div class="cp-list">
            <div class="cp-title">${esc(c.name || "Untitled")}</div>
            <div class="cp-meta">${esc(topic) || "No topic"}</div>
            <div class="cp-copy">${esc(desc)}</div>
          </div>
        `;
      } else {
        btn.innerHTML = `
          <div class="cp-content">
            <div class="cp-top">
              <h2 class="cp-title">${esc(c.name || "Untitled")}</h2>
              <div class="cp-pill">${c.visibility === "public" ? "Public" : "Personal"}</div>
            </div>
            <p class="cp-copy">${esc(desc)}</p>
            <div class="cp-meta">${esc(topic)}</div>
            <div class="cp-tags">
              ${(c.tags || []).slice(0, 4).map(t => `<span class="cp-tag">${esc(t)}</span>`).join("")}
            </div>
            <div class="cp-btn">Open details</div>
          </div>
        `;
      }

      btn.addEventListener("click", () => selectCompendium(c, { navigate: true }));
      root.appendChild(btn);
    }
  }

  function filterCompendiums(items) {
    const query = filterState.search;
    const visibility = filterState.visibility;
    const sort = filterState.sort;

    let filtered = items;

    if (visibility !== "all") {
      filtered = filtered.filter(item => item.visibility === visibility);
    }

    if (query) {
      filtered = filtered.filter(item => matchesSearch(item, query));
    }

    return [...filtered].sort((a, b) => sortCompendiums(a, b, sort));
  }

  function matchesSearch(item, query) {
    const haystack = [
      item.name,
      item.topic,
      item.description,
      ...(item.tags || [])
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(query);
  }

  function sortCompendiums(a, b, sort) {
    if (sort === "name-asc") {
      return (a.name || "").localeCompare(b.name || "");
    }
    if (sort === "name-desc") {
      return (b.name || "").localeCompare(a.name || "");
    }
    const aTime = compendiumTimestamp(a);
    const bTime = compendiumTimestamp(b);
    if (bTime !== aTime) return bTime - aTime;
    return (a.name || "").localeCompare(b.name || "");
  }

  function compendiumTimestamp(item) {
    const stamp = item.updatedAt ?? item.createdAt ?? item.updated_at ?? item.created_at;
    if (!stamp) return 0;
    if (typeof stamp?.toMillis === "function") return stamp.toMillis();
    if (typeof stamp?.seconds === "number") return stamp.seconds * 1000;
    if (stamp instanceof Date) return stamp.getTime();
    const numeric = Number(stamp);
    if (!Number.isNaN(numeric)) return numeric;
    const parsed = Date.parse(stamp);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function entryTimestamp(item) {
    const stamp = item.updatedAt ?? item.createdAt ?? item.updated_at ?? item.created_at;
    if (!stamp) return 0;
    if (typeof stamp?.toMillis === "function") return stamp.toMillis();
    if (typeof stamp?.seconds === "number") return stamp.seconds * 1000;
    if (stamp instanceof Date) return stamp.getTime();
    const numeric = Number(stamp);
    if (!Number.isNaN(numeric)) return numeric;
    const parsed = Date.parse(stamp);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function selectCompendium(comp, { navigate = false } = {}) {
    selectedCompendium = comp ? { id: comp.id, doc: comp } : null;
    if (comp?.visibility) selectedScope = comp.visibility;
    showDetailPanel(selectedScope);
    paintEditor(selectedScope);
    renderLinks();

    const scope = comp?.visibility || selectedScope;
    onSelectCompendium?.(scope, comp?.id || null, comp || null);

    if (navigate) {
      goToRoute("compendium-detail");
    }
  }

  function showDetailPanel(scope) {
    if (scope === "personal") {
      personal.panel?.classList?.remove("is-hidden");
      pub.panel?.classList?.add("is-hidden");
    } else {
      personal.panel?.classList?.add("is-hidden");
      pub.panel?.classList?.remove("is-hidden");
    }
  }

  function paintEditor(scope) {
    const isPersonal = scope === "personal";
    const el = isPersonal ? personal : pub;

    const { id: compId, doc: comp } = getSelectedForScope(scope);

    if (!compId || !comp) {
      el.editorEmpty.classList.remove("is-hidden");
      el.form.classList.add("is-hidden");

      if (isPersonal) {
        personal.title.textContent = "Select a compendium";
        personal.subtitle.textContent = "—";
        personal.btnDelete.disabled = true;
      } else {
        pub.title.textContent = "Select a public compendium";
        pub.subtitle.textContent = "—";
        pub.btnDelete.disabled = true;
        pub.btnSave.disabled = true;
        pub.editorsSection.classList.add("is-hidden");
      }
      return;
    }

    el.editorEmpty.classList.add("is-hidden");
    el.form.classList.remove("is-hidden");

    el.title.textContent = comp.name || "Untitled";
    el.subtitle.textContent = comp.topic ? `Topic: ${comp.topic}` : "—";
    el.ownerLine.textContent = `Owner: ${comp.ownerEmail || comp.ownerUid}`;

    // Fill fields
    el.name.value = comp.name || "";
    el.topic.value = comp.topic || "";
    el.desc.value = comp.description || "";
    el.tags.value = (comp.tags || []).join(", ");

    if (isPersonal) {
      el.btnDelete.disabled = !isOwner(user, comp);
      el.btnSave.disabled = !canEditCompendium(user, comp);
    } else {
      const editable = canEditCompendium(user, comp);

      el.name.disabled = !editable;
      el.topic.disabled = !editable;
      el.desc.disabled = !editable;
      el.tags.disabled = !editable;

      el.btnSave.disabled = !editable;
      el.btnDelete.disabled = !isOwner(user, comp);

      pub.editHint.textContent = editable
        ? "You can edit title/topic/description/tags (type is locked)."
        : "Read-only compendium details (you can still add entries).";

      if (canManageEditors(user, comp)) {
        pub.editorsSection.classList.remove("is-hidden");
        renderEditorChips(comp);
      } else {
        pub.editorsSection.classList.add("is-hidden");
      }
    }
  }

  function getSelectedForScope(scope) {
    if (selectedCompendium?.doc?.visibility !== scope) {
      return { id: null, doc: null };
    }
    return { id: selectedCompendium.id, doc: selectedCompendium.doc };
  }

  async function createFromModal() {
    const name = modal.name.value.trim();
    const topic = modal.topic.value.trim();
    const description = modal.desc.value.trim();
    const tags = parseTags(modal.tags.value);

    const type = $$('input[name="newCompType"]').find(x => x.checked)?.value || "personal";
    if (!name || !topic) return showModalError("Name and topic are required.");
    if (type !== "personal" && type !== "public") return showModalError("Invalid type.");

    const coverSeed = stableSeed();

    try {
      await createCompendium({
        name,
        topic,
        description,
        tags,

        coverUrl: "",
        coverSeed: coverSeed || "",

        visibility: type,
        ownerUid: user.uid,
        ownerEmail: normEmail(user.email || ""),

        editorEmails: type === "public" ? [] : []
      });

      modal.dlg.close?.();
      toast("Compendium created");
    } catch (e) {
      showModalError(e?.message || "Create failed");
    }
  }

  function showModalError(msg) {
    modal.err.textContent = msg;
    modal.err.classList.remove("is-hidden");
  }

  async function saveCompendium(scope) {
    const isPersonal = scope === "personal";
    const { id: compId, doc: comp } = getSelectedForScope(scope);
    if (!compId || !comp) return;

    if (!canEditCompendium(user, comp)) {
      toast("You cannot edit this compendium", "bad");
      return;
    }

    const el = isPersonal ? personal : pub;

    const name = el.name.value.trim();
    const topic = el.topic.value.trim();
    const description = el.desc.value.trim();
    const tags = parseTags(el.tags.value);

    if (!name || !topic) {
      toast("Name and topic required", "bad");
      return;
    }

    // Ensure a seed exists if coverUrl is blank (for older docs)
    const updates = { name, topic, description, tags };
    if (!comp.coverSeed) updates.coverSeed = stableSeed();

    try {
      await updateCompendium(compId, updates);
      toast("Saved");
    } catch (e) {
      toast(e?.message || "Save failed", "bad");
    }
  }

  async function removeCompendium(scope) {
    const isPersonal = scope === "personal";
    const { id: compId, doc: comp } = getSelectedForScope(scope);
    if (!compId || !comp) return;

    if (!isOwner(user, comp)) {
      toast("Owner only", "bad");
      return;
    }

    const ok = confirm("Delete this compendium?\n\nNote: entries remain unless you delete them separately.");
    if (!ok) return;

    try {
      await deleteCompendium(compId);
      toast("Deleted");

      selectCompendium(null, { navigate: false });
    } catch (e) {
      toast(e?.message || "Delete failed", "bad");
    }
  }

  function renderEditorChips(comp) {
    pub.editorChips.innerHTML = "";
    const emails = Array.isArray(comp.editorEmails) ? comp.editorEmails : [];

    if (!emails.length) {
      const d = document.createElement("div");
      d.className = "subtle small";
      d.textContent = "No editors added yet.";
      pub.editorChips.appendChild(d);
      return;
    }

    for (const email of emails) {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.innerHTML = `
        <span>${esc(email)}</span>
        <button type="button" class="chip__x" aria-label="Remove">
          <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M18.3 5.7L12 12l6.3 6.3-1.4 1.4L10.6 13.4 4.3 19.7 2.9 18.3 9.2 12 2.9 5.7 4.3 4.3 10.6 10.6 16.9 4.3z"/></svg>
        </button>
      `;
      chip.querySelector(".chip__x").addEventListener("click", () => dropEditor(email));
      pub.editorChips.appendChild(chip);
    }
  }

  async function addEditor() {
    const { id: compId, doc: comp } = getSelectedForScope("public");
    if (!comp || !compId) return;

    if (!canManageEditors(user, comp)) {
      toast("Owner only", "bad");
      return;
    }

    const email = normEmail(pub.editorInput.value);
    if (!isValidEmail(email)) return toast("Invalid email", "bad");
    if (email === normEmail(user.email || "")) return toast("You are the owner", "bad");

    try {
      await addCompendiumEditor(compId, email);
      pub.editorInput.value = "";
      toast("Editor added");
    } catch (e) {
      toast(e?.message || "Failed to add editor", "bad");
    }
  }

  async function dropEditor(email) {
    const { id: compId, doc: comp } = getSelectedForScope("public");
    if (!comp || !compId) return;

    if (!canManageEditors(user, comp)) {
      toast("Owner only", "bad");
      return;
    }

    try {
      await removeCompendiumEditor(compId, normEmail(email));
      toast("Editor removed");
    } catch (e) {
      toast(e?.message || "Failed to remove editor", "bad");
    }
  }

  // Public API (useful for future)
  return {
    getSelected(scope) {
      return getSelectedForScope(scope);
    }
  };
}
