import {
  listenEntries,
  createEntry,
  updateEntry,
  deleteEntry,
  uploadEntryImage
} from "./firebase.js";

const $ = (s, r=document) => r.querySelector(s);
function esc(s){ return (s ?? "").toString(); }
function normEmail(e){ return (e || "").trim().toLowerCase(); }

function toast(msg, kind="ok") {
  const el = document.createElement("div");
  el.className = `toast toast--${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-on"));
  setTimeout(() => { el.classList.remove("is-on"); setTimeout(() => el.remove(), 220); }, 2200);
}

function isOwner(user, comp){ return comp?.ownerUid === user.uid; }
function isEditor(user, comp){
  if (!comp || comp.visibility !== "public") return false;
  const emails = Array.isArray(comp.editorEmails) ? comp.editorEmails : [];
  return emails.includes(normEmail(user.email || ""));
}
function canAddEntry(user, comp){
  if (!comp) return false;
  if (comp.visibility === "public") return true;
  return isOwner(user, comp);
}
function canEditEntry(user, comp, entry){
  if (!entry) return false;
  if (entry.createdByUid === user.uid) return true;
  if (comp?.visibility === "public" && (isOwner(user, comp) || isEditor(user, comp))) return true;
  return false;
}

export function initEntries({ user }) {
  const ui = {
    personalCount: $("#personalEntriesCount"),
    publicCount: $("#publicEntriesCount"),
    personalList: $("#personalEntriesList"),
    publicList: $("#publicEntriesList"),

    btnAddPersonal: $("#btnAddPersonalEntry"),
    btnAddPublic: $("#btnAddPublicEntry"),

    dlg: $("#entryModal"),
    title: $("#entryModalTitle"),
    sub: $("#entryModalSub"),
    err: $("#entryError"),

    entryTitle: $("#entryTitle"),
    entryDesc: $("#entryDesc"),
    entryUrl: $("#entryImageUrl"),
    entryFile: $("#entryImageFile"),

    previewWrap: $("#entryPreviewWrap"),
    previewImg: $("#entryPreviewImg"),

    btnSave: $("#btnSaveEntry")
  };

  let active = {
    scope: null,
    compId: null,
    compDoc: null
  };

  let unsub = null;

  let editingId = null;
  let editingData = null;

  ui.entryFile.addEventListener("change", updatePreview);
  ui.entryUrl.addEventListener("input", updatePreview);

  ui.btnSave.addEventListener("click", save);

  ui.btnAddPersonal.addEventListener("click", () => {
    if (!active.compDoc || active.scope !== "personal") return;
    openModal("personal", null, null);
  });

  ui.btnAddPublic.addEventListener("click", () => {
    if (!active.compDoc || active.scope !== "public") return;
    openModal("public", null, null);
  });

  function resetLists() {
    ui.personalList.innerHTML = "";
    ui.publicList.innerHTML = "";
    ui.personalCount.textContent = "—";
    ui.publicCount.textContent = "—";
    ui.btnAddPersonal.disabled = true;
    ui.btnAddPublic.disabled = true;
  }

  function resetInactive(scope) {
    if (scope === "personal") {
      ui.publicList.innerHTML = "";
      ui.publicCount.textContent = "—";
      ui.btnAddPublic.disabled = true;
    } else if (scope === "public") {
      ui.personalList.innerHTML = "";
      ui.personalCount.textContent = "—";
      ui.btnAddPersonal.disabled = true;
    }
  }

  function setActiveCompendium(scope, compId, compDoc) {
    // called by compendiums module
    active = { scope, compId, compDoc };

    unsub?.();
    unsub = null;

    if (scope !== "personal" && scope !== "public") {
      resetLists();
      return;
    }

    // Clear UI if nothing selected
    if (!compId || !compDoc) {
      resetLists();
      return;
    }

    resetInactive(scope);

    // Enable/disable add button UI-side
    if (scope === "personal") ui.btnAddPersonal.disabled = !canAddEntry(user, compDoc);
    if (scope === "public") ui.btnAddPublic.disabled = !canAddEntry(user, compDoc);

    unsub = listenEntries(compId, (entries) => {
      if (scope === "personal") {
        ui.personalCount.textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
        render(entries, "personal");
      } else {
        ui.publicCount.textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
        render(entries, "public");
      }
    }, (err) => {
      console.error(err);
      toast(err?.message || "Failed to load entries", "bad");
    });
  }

  function render(entries, scope) {
    const root = scope === "personal" ? ui.personalList : ui.publicList;
    const comp = active.compDoc;
    root.innerHTML = "";

    if (!entries.length) {
      const d = document.createElement("div");
      d.className = "subtle";
      d.textContent = "No entries yet.";
      root.appendChild(d);
      return;
    }

    for (const e of entries) {
      const card = document.createElement("div");
      card.className = "card";

      const img = e.imageUrl
        ? `<img class="thumb" src="${esc(e.imageUrl)}" alt="Entry image" loading="lazy" />`
        : `<div class="thumb thumb--empty">No image</div>`;

      const allowEdit = canEditEntry(user, comp, e);

      card.innerHTML = `
        <div class="card__row">
          ${img}
          <div class="card__body">
            <div class="card__title">${esc(e.title || "Untitled")}</div>
            <div class="card__text">${esc((e.description || "").slice(0, 240))}${(e.description || "").length > 240 ? "…" : ""}</div>
            <div class="card__meta">by ${esc(e.createdByEmail || e.createdByUid || "unknown")}</div>
            <div class="card__actions">
              <button class="btn" data-act="edit" type="button" ${allowEdit ? "" : "disabled"}>Edit</button>
              <button class="btn btn--danger" data-act="del" type="button" ${allowEdit ? "" : "disabled"}>Delete</button>
            </div>
          </div>
        </div>
      `;

      card.querySelector('[data-act="edit"]').addEventListener("click", () => openModal(scope, e.id, e));
      card.querySelector('[data-act="del"]').addEventListener("click", () => remove(e));

      root.appendChild(card);
    }
  }

  function openModal(scope, entryId, entryData) {
    if (!active.compDoc || !active.compId) return;

    if (!entryId && !canAddEntry(user, active.compDoc)) {
      toast("You cannot add entries here", "bad");
      return;
    }
    if (entryId && !canEditEntry(user, active.compDoc, entryData)) {
      toast("You cannot edit this entry", "bad");
      return;
    }

    editingId = entryId;
    editingData = entryData;

    ui.title.textContent = entryId ? "Edit Entry" : "Add Entry";
    ui.sub.textContent = active.compDoc?.name || "—";

    ui.err.classList.add("is-hidden");
    ui.err.textContent = "";

    ui.entryTitle.value = entryData?.title || "";
    ui.entryDesc.value = entryData?.description || "";
    ui.entryUrl.value = entryData?.imageUrl || "";
    ui.entryFile.value = "";

    updatePreview();
    ui.dlg.showModal?.();
  }

  function showError(msg) {
    ui.err.textContent = msg;
    ui.err.classList.remove("is-hidden");
  }

  function updatePreview() {
    const url = ui.entryUrl.value.trim();
    const file = ui.entryFile.files?.[0] || null;

    if (file) {
      ui.previewImg.src = URL.createObjectURL(file);
      ui.previewWrap.classList.remove("is-hidden");
      return;
    }
    if (url) {
      ui.previewImg.src = url;
      ui.previewWrap.classList.remove("is-hidden");
      return;
    }
    ui.previewWrap.classList.add("is-hidden");
    ui.previewImg.removeAttribute("src");
  }

  async function save() {
    if (!active.compDoc || !active.compId) return;

    const title = ui.entryTitle.value.trim();
    const description = ui.entryDesc.value.trim();
    const url = ui.entryUrl.value.trim();
    const file = ui.entryFile.files?.[0] || null;

    if (!title || !description) return showError("Title and description are required.");

    if (!editingId && !canAddEntry(user, active.compDoc)) return showError("You cannot add entries here.");
    if (editingId && !canEditEntry(user, active.compDoc, editingData)) return showError("You cannot edit this entry.");

    try {
      let imageUrl = url || "";

      if (file) {
        imageUrl = await uploadEntryImage(active.compId, file);
      }

      if (editingId) {
        await updateEntry(editingId, { title, description, imageUrl });
        toast("Entry updated");
      } else {
        await createEntry({
          compendiumId: active.compId,
          title,
          description,
          imageUrl,
          createdByUid: user.uid,
          createdByEmail: normEmail(user.email || "")
        });
        toast("Entry created");
      }

      ui.dlg.close?.();
    } catch (e) {
      showError(e?.message || "Save failed");
    }
  }

  async function remove(entry) {
    if (!canEditEntry(user, active.compDoc, entry)) return toast("Not allowed", "bad");

    const ok = confirm("Delete this entry?");
    if (!ok) return;

    try {
      await deleteEntry(entry.id);
      toast("Deleted");
    } catch (e) {
      toast(e?.message || "Delete failed", "bad");
    }
  }

  return { setActiveCompendium };
}
