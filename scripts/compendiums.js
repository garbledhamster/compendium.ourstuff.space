import {
  listenPersonalCompendiums,
  listenPublicCompendiums,
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
    list: $("#personalCompendiumList"),
    count: $("#personalCount"),
    editorEmpty: $("#personalEditorEmpty"),
    form: $("#personalCompendiumForm"),
    title: $("#personalEditorTitle"),
    subtitle: $("#personalEditorSubtitle"),
    ownerLine: $("#personalOwnerLine"),
    typePill: $("#personalTypePill"),
    coverPreview: $("#personalCoverPreview"),

    name: $("#personalCompName"),
    topic: $("#personalCompTopic"),
    desc: $("#personalCompDesc"),
    coverUrl: $("#personalCompCoverUrl"),
    tags: $("#personalCompTags"),

    btnSave: $("#btnSavePersonalCompendium"),
    btnDelete: $("#btnDeleteCompendium")
  };

  const pub = {
    panel: $("#publicEditorPanel"),
    list: $("#publicCompendiumList"),
    count: $("#publicCount"),
    editorEmpty: $("#publicEditorEmpty"),
    form: $("#publicCompendiumForm"),
    title: $("#publicEditorTitle"),
    subtitle: $("#publicEditorSubtitle"),
    ownerLine: $("#publicOwnerLine"),
    typePill: $("#publicTypePill"),
    coverPreview: $("#publicCoverPreview"),

    name: $("#publicCompName"),
    topic: $("#publicCompTopic"),
    desc: $("#publicCompDesc"),
    coverUrl: $("#publicCompCoverUrl"),
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
    coverUrl: $("#newCompCoverUrl"),
    tags: $("#newCompTags"),
    btnCreate: $("#btnCreateComp")
  };

  // --- State ---
  let personalUnsub = null;
  let publicUnsub = null;

  let personalItems = [];
  let publicItems = [];

  let selectedPersonalId = null;
  let selectedPublicId = null;

  let selectedPersonalDoc = null;
  let selectedPublicDoc = null;
  let selectedScope = "personal";

  // --- Events ---
  $("#btnNewCompendium").addEventListener("click", () => {
    modal.err.classList.add("is-hidden");
    modal.err.textContent = "";
    modal.name.value = "";
    modal.topic.value = "";
    modal.desc.value = "";
    modal.coverUrl.value = "";
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
  pub.coverUrl.addEventListener("input", () => updateCoverPreview(pub.coverPreview, pub.coverUrl.value, selectedPublicDoc));
  personal.coverUrl.addEventListener("input", () => updateCoverPreview(personal.coverPreview, personal.coverUrl.value, selectedPersonalDoc));

  $$('[data-action="back-to-compendiums"]').forEach((btn) => {
    btn.addEventListener("click", () => goToRoute("compendiums"));
  });

  // --- Listen ---
  listenPersonal();
  listenPublic();

  function listenPersonal() {
    personalUnsub?.();
    personalUnsub = listenPersonalCompendiums(user.uid, (items) => {
      personalItems = items;
      personal.count.textContent = fmtCount(items.length, "compendium");
      renderPicker(personal.list, items, "personal");
      if (selectedPersonalId) {
        const found = items.find(x => x.id === selectedPersonalId);
        if (found) select("personal", found.id, found, { navigate: false });
        else select("personal", null, null, { navigate: false });
      } else {
        select("personal", null, null, { navigate: false });
      }
    }, (err) => {
      console.error(err);
      toast(err?.message || "Failed to load personal compendiums", "bad");
    });
  }

  function listenPublic() {
    publicUnsub?.();
    publicUnsub = listenPublicCompendiums((items) => {
      publicItems = items;
      pub.count.textContent = fmtCount(items.length, "compendium");
      renderPicker(pub.list, items, "public");
      if (selectedPublicId) {
        const found = items.find(x => x.id === selectedPublicId);
        if (found) select("public", found.id, found, { navigate: false });
        else select("public", null, null, { navigate: false });
      } else {
        select("public", null, null, { navigate: false });
      }
    }, (err) => {
      console.error(err);
      toast(err?.message || "Failed to load public compendiums", "bad");
    });
  }

  function renderPicker(root, items, scope) {
    root.innerHTML = "";

    if (!items.length) {
      const d = document.createElement("div");
      d.className = "subtle";
      d.textContent = scope === "personal"
        ? "No personal compendiums yet — click New to create one."
        : "No public compendiums yet.";
      root.appendChild(d);
      return;
    }

    const activeId = scope === "personal" ? selectedPersonalId : selectedPublicId;

    for (const c of items) {
      const cover = coverUrlFor(c);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cp-card" + (c.id === activeId ? " is-active" : "");
      btn.style.setProperty("--cp-bg", `url("${cover}")`);

      const desc = (c.description || "").trim() || "No description yet.";
      const topic = (c.topic || "").trim();

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

      btn.addEventListener("click", () => select(scope, c.id, c, { navigate: true }));
      root.appendChild(btn);
    }
  }

  function select(scope, id, doc, { navigate = false } = {}) {
    selectedScope = scope;
    showDetailPanel(scope);

    if (scope === "personal") {
      selectedPersonalId = id;
      selectedPersonalDoc = doc || null;
      paintEditor("personal");
    } else {
      selectedPublicId = id;
      selectedPublicDoc = doc || null;
      paintEditor("public");
    }

    // notify entries module
    onSelectCompendium?.(scope, id, doc || null);

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

    const compId = isPersonal ? selectedPersonalId : selectedPublicId;
    const comp = isPersonal ? selectedPersonalDoc : selectedPublicDoc;

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
    el.coverUrl.value = comp.coverUrl || "";
    el.tags.value = (comp.tags || []).join(", ");

    updateCoverPreview(el.coverPreview, el.coverUrl.value, comp);

    if (isPersonal) {
      el.btnDelete.disabled = !isOwner(user, comp);
      el.btnSave.disabled = !canEditCompendium(user, comp);
    } else {
      const editable = canEditCompendium(user, comp);

      el.name.disabled = !editable;
      el.topic.disabled = !editable;
      el.desc.disabled = !editable;
      el.coverUrl.disabled = !editable;
      el.tags.disabled = !editable;

      el.btnSave.disabled = !editable;
      el.btnDelete.disabled = !isOwner(user, comp);

      pub.editHint.textContent = editable
        ? "You can edit title/topic/description/cover/tags (type is locked)."
        : "Read-only compendium details (you can still add entries).";

      if (canManageEditors(user, comp)) {
        pub.editorsSection.classList.remove("is-hidden");
        renderEditorChips(comp);
      } else {
        pub.editorsSection.classList.add("is-hidden");
      }
    }
  }

  function updateCoverPreview(previewEl, coverUrl, comp) {
    const url = (coverUrl || "").trim() || coverUrlFor(comp);
    previewEl.style.setProperty("--cover", `url("${url}")`);
  }

  async function createFromModal() {
    const name = modal.name.value.trim();
    const topic = modal.topic.value.trim();
    const description = modal.desc.value.trim();
    const coverUrl = modal.coverUrl.value.trim();
    const tags = parseTags(modal.tags.value);

    const type = $$('input[name="newCompType"]').find(x => x.checked)?.value || "personal";
    if (!name || !topic) return showModalError("Name and topic are required.");
    if (type !== "personal" && type !== "public") return showModalError("Invalid type.");

    const coverSeed = coverUrl ? "" : stableSeed();

    try {
      await createCompendium({
        name,
        topic,
        description,
        tags,

        coverUrl: coverUrl || "",
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
    const compId = isPersonal ? selectedPersonalId : selectedPublicId;
    const comp = isPersonal ? selectedPersonalDoc : selectedPublicDoc;
    if (!compId || !comp) return;

    if (!canEditCompendium(user, comp)) {
      toast("You cannot edit this compendium", "bad");
      return;
    }

    const el = isPersonal ? personal : pub;

    const name = el.name.value.trim();
    const topic = el.topic.value.trim();
    const description = el.desc.value.trim();
    const coverUrl = el.coverUrl.value.trim();
    const tags = parseTags(el.tags.value);

    if (!name || !topic) {
      toast("Name and topic required", "bad");
      return;
    }

    // Ensure a seed exists if coverUrl is blank (for older docs)
    const updates = { name, topic, description, coverUrl: coverUrl || "", tags };
    if (!coverUrl && !comp.coverSeed) updates.coverSeed = stableSeed();

    try {
      await updateCompendium(compId, updates);
      toast("Saved");
    } catch (e) {
      toast(e?.message || "Save failed", "bad");
    }
  }

  async function removeCompendium(scope) {
    const isPersonal = scope === "personal";
    const compId = isPersonal ? selectedPersonalId : selectedPublicId;
    const comp = isPersonal ? selectedPersonalDoc : selectedPublicDoc;
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

      if (scope === "personal") select("personal", null, null, { navigate: false });
      else select("public", null, null, { navigate: false });
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
    const comp = selectedPublicDoc;
    const compId = selectedPublicId;
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
    const comp = selectedPublicDoc;
    const compId = selectedPublicId;
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
      return scope === "personal"
        ? { id: selectedPersonalId, doc: selectedPersonalDoc }
        : { id: selectedPublicId, doc: selectedPublicDoc };
    }
  };
}
