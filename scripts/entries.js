import {
  listenEntries,
  createEntry,
  updateEntry,
  deleteEntry
} from "./firebase.js";
import { renderMarkdown } from "./markdown.js";

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
    entryTags: $("#entryTags"),
    entrySources: $("#entrySources"),
    entryUrlInput: $("#entryImageUrlInput"),
    btnAddEntryImageUrl: $("#btnAddEntryImageUrl"),
    entryImageUrlsList: $("#entryImageUrlsList"),
    entryImageUrlsEmpty: $("#entryImageUrlsEmpty"),

    previewWrap: $("#entryPreviewWrap"),
    previewImg: $("#entryPreviewImg"),
    previewIndexLabel: $("#entryPreviewIndex"),
    btnPreviewPrev: $("#btnPreviewPrev"),
    btnPreviewNext: $("#btnPreviewNext"),

    btnSave: $("#btnSaveEntry"),

    readerDlg: $("#entryReaderModal"),
    readerTitle: $("#entryReaderTitle"),
    readerSub: $("#entryReaderSub"),
    readerMeta: $("#entryReaderMeta"),
    readerDesc: $("#entryReaderDescription"),
    readerMedia: $("#entryReaderMedia"),
    readerImage: $("#entryReaderImage"),
    readerTagsWrap: $("#entryReaderTagsWrap"),
    readerTags: $("#entryReaderTags"),
    readerSourcesWrap: $("#entryReaderSourcesWrap"),
    readerSources: $("#entryReaderSources"),
    btnReaderEdit: $("#btnReaderEdit"),
    btnReaderDelete: $("#btnReaderDelete")
  };

  const missing = Object.entries(ui)
    .filter(([, el]) => !el)
    .map(([key]) => key);

  if (missing.length) {
    console.warn("Entries UI is missing expected elements:", missing);
    return {
      setActiveCompendium() {}
    };
  }

  let active = {
    scope: null,
    compId: null,
    compDoc: null
  };

  let unsub = null;

  let editingId = null;
  let editingData = null;
  let imageUrls = [];
  let previewIndex = 0;
  let readerEntry = null;
  let readerScope = null;

  ui.entryUrlInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addImageUrlFromInput();
    }
  });
  ui.btnAddEntryImageUrl.addEventListener("click", addImageUrlFromInput);
  ui.entryImageUrlsList.addEventListener("click", handleImageUrlListAction);
  ui.btnPreviewPrev.addEventListener("click", () => changePreviewIndex(-1));
  ui.btnPreviewNext.addEventListener("click", () => changePreviewIndex(1));

  ui.btnSave.addEventListener("click", save);
  ui.btnReaderEdit.addEventListener("click", () => {
    if (!readerEntry || !readerScope) return;
    if (!canEditEntry(user, active.compDoc, readerEntry)) return;
    ui.readerDlg.close?.();
    openModal(readerScope, readerEntry.id, readerEntry);
  });
  ui.btnReaderDelete.addEventListener("click", async () => {
    if (!readerEntry) return;
    ui.readerDlg.close?.();
    await remove(readerEntry);
  });

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

    for (const [index, e] of entries.entries()) {
      const card = document.createElement("div");
      card.className = "card";

      const primaryImageUrl = getPrimaryImageUrl(e);
      const img = primaryImageUrl
        ? `<img class="thumb" src="${esc(primaryImageUrl)}" alt="Entry image" loading="lazy" />`
        : `<div class="thumb thumb--empty">No image</div>`;

      const allowEdit = canEditEntry(user, comp, e);
      const prevEntry = entries[index - 1];
      const nextEntry = entries[index + 1];
      const allowMoveUp = allowEdit && prevEntry && canEditEntry(user, comp, prevEntry);
      const allowMoveDown = allowEdit && nextEntry && canEditEntry(user, comp, nextEntry);
      const tags = Array.isArray(e.tags) ? e.tags : [];
      const sources = Array.isArray(e.sources) ? e.sources : [];
      const tagList = tags.length
        ? `<div class="card__tags">${tags.map((tag) => `<span class="card__tag">${esc(tag)}</span>`).join("")}</div>`
        : "";
      const sourceList = sources.length
        ? `<div class="card__sources"><span class="card__sources-label">Sources:</span> ${sources.map((source) => `<span class="card__source">${esc(source)}</span>`).join("")}</div>`
        : "";
      const reorderActions = allowEdit
        ? `
          <button class="btn btn--outline" data-act="move-up" type="button" ${allowMoveUp ? "" : "disabled"}>Up</button>
          <button class="btn btn--outline" data-act="move-down" type="button" ${allowMoveDown ? "" : "disabled"}>Down</button>
        `
        : "";
      const editActions = allowEdit
        ? `
          <button class="btn btn--secondary" data-act="edit" type="button">Edit</button>
          <button class="btn btn--danger" data-act="del" type="button">Delete</button>
        `
        : "";

      card.innerHTML = `
        <div class="card__row">
          ${img}
          <div class="card__body">
            <div class="card__title">${esc(e.title || "Untitled")}</div>
            <div class="card__text">${esc((e.description || "").slice(0, 240))}${(e.description || "").length > 240 ? "…" : ""}</div>
            ${tagList}
            ${sourceList}
            <div class="card__meta">by ${esc(e.createdByEmail || e.createdByUid || "unknown")}</div>
            <div class="card__actions">
              <button class="btn btn--secondary" data-act="read" type="button">Read</button>
              ${reorderActions}
              ${editActions}
            </div>
          </div>
        </div>
      `;

      card.querySelector('[data-act="read"]').addEventListener("click", () => openReader(scope, e));
      const editBtn = card.querySelector('[data-act="edit"]');
      const delBtn = card.querySelector('[data-act="del"]');
      const upBtn = card.querySelector('[data-act="move-up"]');
      const downBtn = card.querySelector('[data-act="move-down"]');
      editBtn?.addEventListener("click", () => openModal(scope, e.id, e));
      delBtn?.addEventListener("click", () => remove(e));
      upBtn?.addEventListener("click", () => reorderEntry(entries, index, -1));
      downBtn?.addEventListener("click", () => reorderEntry(entries, index, 1));

      root.appendChild(card);
    }
  }

  function openReader(scope, entryData) {
    if (!active.compDoc || !entryData) return;

    readerEntry = entryData;
    readerScope = scope;

    ui.readerTitle.textContent = entryData?.title || "Untitled";
    ui.readerSub.textContent = active.compDoc?.name || "—";
    ui.readerMeta.textContent = `by ${esc(entryData?.createdByEmail || entryData?.createdByUid || "unknown")}`;
    ui.readerDesc.innerHTML = renderMarkdown(entryData?.description || "");

    const primaryImageUrl = getPrimaryImageUrl(entryData);
    if (primaryImageUrl) {
      ui.readerImage.src = primaryImageUrl;
      ui.readerMedia.classList.remove("is-hidden");
    } else {
      ui.readerMedia.classList.add("is-hidden");
      ui.readerImage.removeAttribute("src");
    }

    const tags = Array.isArray(entryData?.tags) ? entryData.tags : [];
    ui.readerTags.innerHTML = "";
    if (tags.length) {
      tags.forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "reader__tag";
        chip.textContent = tag;
        ui.readerTags.appendChild(chip);
      });
      ui.readerTagsWrap.classList.remove("is-hidden");
    } else {
      ui.readerTagsWrap.classList.add("is-hidden");
    }

    const sources = Array.isArray(entryData?.sources) ? entryData.sources : [];
    ui.readerSources.innerHTML = "";
    if (sources.length) {
      sources.forEach((source) => {
        const item = document.createElement("span");
        item.className = "reader__source";
        item.textContent = source;
        ui.readerSources.appendChild(item);
      });
      ui.readerSourcesWrap.classList.remove("is-hidden");
    } else {
      ui.readerSourcesWrap.classList.add("is-hidden");
    }

    const allowEdit = canEditEntry(user, active.compDoc, entryData);
    ui.btnReaderEdit.classList.toggle("is-hidden", !allowEdit);
    ui.btnReaderDelete.classList.toggle("is-hidden", !allowEdit);

    ui.readerDlg.showModal?.();
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
    ui.entryTags.value = Array.isArray(entryData?.tags) ? entryData.tags.join(", ") : (entryData?.tags || "");
    ui.entrySources.value = Array.isArray(entryData?.sources) ? entryData.sources.join("\n") : (entryData?.sources || "");
    imageUrls = getEntryImageUrls(entryData);
    previewIndex = 0;
    ui.entryUrlInput.value = "";

    renderImageUrlList();
    updatePreview();
    ui.dlg.showModal?.();
  }

  function showError(msg) {
    ui.err.textContent = msg;
    ui.err.classList.remove("is-hidden");
  }

  function updatePreview() {
    const hasImages = imageUrls.length > 0;
    previewIndex = Math.max(0, Math.min(previewIndex, imageUrls.length - 1));
    const primaryImageUrl = imageUrls[previewIndex] || "";

    if (primaryImageUrl && hasImages) {
      ui.previewImg.src = primaryImageUrl;
      ui.previewWrap.classList.remove("is-hidden");
    } else {
      ui.previewWrap.classList.add("is-hidden");
      ui.previewImg.removeAttribute("src");
    }

    ui.previewIndexLabel.textContent = hasImages ? `${previewIndex + 1}/${imageUrls.length}` : "0/0";
    const disableNav = imageUrls.length < 2;
    ui.btnPreviewPrev.disabled = disableNav;
    ui.btnPreviewNext.disabled = disableNav;
  }

  async function save() {
    if (!active.compDoc || !active.compId) return;

    const title = ui.entryTitle.value.trim();
    const description = ui.entryDesc.value.trim();
    const tags = normalizeList(ui.entryTags.value);
    const sources = normalizeList(ui.entrySources.value);
    addImageUrlFromInput({ silent: true });

    if (!title || !description) return showError("Title and details are required.");

    if (!editingId && !canAddEntry(user, active.compDoc)) return showError("You cannot add entries here.");
    if (editingId && !canEditEntry(user, active.compDoc, editingData)) return showError("You cannot edit this entry.");

    try {
      const imageUrlsToSave = [...imageUrls];

      if (editingId) {
        await updateEntry(editingId, { title, description, imageUrls: imageUrlsToSave, tags, sources });
        toast("Entry updated");
      } else {
        await createEntry({
          compendiumId: active.compId,
          title,
          description,
          imageUrls: imageUrlsToSave,
          tags,
          sources,
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

  function normalizeList(value) {
    return (value || "")
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function getEntryImageUrls(entryData) {
    if (!entryData) return [];
    const urls = Array.isArray(entryData.imageUrls) ? entryData.imageUrls : [];
    if (urls.length) return urls.filter(Boolean);
    if (entryData.imageUrl) return [entryData.imageUrl];
    return [];
  }

  function getPrimaryImageUrl(entryData) {
    const urls = getEntryImageUrls(entryData);
    return urls[0] || "";
  }

  function getEntryOrderValue(entryData, index) {
    if (typeof entryData?.order === "number") return entryData.order;
    if (typeof entryData?.createdAt?.toMillis === "function") return entryData.createdAt.toMillis();
    return Date.now() + index;
  }

  function addImageUrlFromInput({ silent = false } = {}) {
    const value = ui.entryUrlInput.value.trim();
    if (!value) return;
    imageUrls = [...imageUrls, value];
    if (imageUrls.length === 1) {
      previewIndex = 0;
    }
    ui.entryUrlInput.value = "";
    renderImageUrlList();
    updatePreview();
    if (!silent) {
      ui.entryUrlInput.focus();
    }
  }

  function handleImageUrlListAction(event) {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    const index = Number(btn.dataset.index);
    if (Number.isNaN(index)) return;

    const action = btn.dataset.action;
    if (action === "move-up") moveImageUrl(index, -1);
    if (action === "move-down") moveImageUrl(index, 1);
    if (action === "delete") removeImageUrl(index);
  }

  function moveImageUrl(index, delta) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= imageUrls.length) return;
    const updated = [...imageUrls];
    const [item] = updated.splice(index, 1);
    updated.splice(nextIndex, 0, item);
    imageUrls = updated;
    if (previewIndex === index) {
      previewIndex = nextIndex;
    } else if (previewIndex === nextIndex) {
      previewIndex = index;
    }
    renderImageUrlList();
    updatePreview();
  }

  function removeImageUrl(index) {
    imageUrls = imageUrls.filter((_, idx) => idx !== index);
    if (previewIndex >= imageUrls.length) {
      previewIndex = Math.max(0, imageUrls.length - 1);
    }
    renderImageUrlList();
    updatePreview();
  }

  function changePreviewIndex(delta) {
    if (!imageUrls.length) return;
    if (imageUrls.length === 1) {
      previewIndex = 0;
    } else {
      previewIndex = (previewIndex + delta + imageUrls.length) % imageUrls.length;
    }
    updatePreview();
  }

  function renderImageUrlList() {
    ui.entryImageUrlsList.innerHTML = "";
    ui.entryImageUrlsEmpty.classList.toggle("is-hidden", imageUrls.length > 0);

    imageUrls.forEach((url, index) => {
      const row = document.createElement("div");
      row.className = "hstack";
      row.setAttribute("role", "option");
      row.setAttribute("aria-label", `Image URL ${index + 1}`);

      const indexLabel = document.createElement("span");
      indexLabel.className = "subtle small";
      indexLabel.textContent = `${index + 1}.`;

      const urlText = document.createElement("span");
      urlText.textContent = url;

      const controls = document.createElement("div");
      controls.className = "hstack";
      controls.innerHTML = `
        <button class="btn btn--outline" data-action="move-up" data-index="${index}" type="button">Up</button>
        <button class="btn btn--outline" data-action="move-down" data-index="${index}" type="button">Down</button>
        <button class="btn btn--danger" data-action="delete" data-index="${index}" type="button">Delete</button>
      `;

      row.appendChild(indexLabel);
      row.appendChild(urlText);
      row.appendChild(controls);
      ui.entryImageUrlsList.appendChild(row);
    });
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

  async function reorderEntry(entries, index, delta) {
    const targetIndex = index + delta;
    if (targetIndex < 0 || targetIndex >= entries.length) return;
    const entry = entries[index];
    const targetEntry = entries[targetIndex];
    if (!canEditEntry(user, active.compDoc, entry) || !canEditEntry(user, active.compDoc, targetEntry)) {
      toast("Not allowed", "bad");
      return;
    }
    const entryOrder = getEntryOrderValue(entry, index);
    const targetOrder = getEntryOrderValue(targetEntry, targetIndex);
    try {
      await Promise.all([
        updateEntry(entry.id, { order: targetOrder }),
        updateEntry(targetEntry.id, { order: entryOrder })
      ]);
    } catch (e) {
      toast(e?.message || "Reorder failed", "bad");
    }
  }

  return { setActiveCompendium };
}
