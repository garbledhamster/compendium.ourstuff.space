import {
  listenEntries,
  createEntry,
  updateEntry,
  deleteEntry
} from "./firebase.js";
import { renderMarkdown } from "./markdown.js";
import { PillInput } from "./pill-input.js";

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

export function initEntries({ user, postName = "" }) {
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
    reader: $("#entryReader"),
    readerMedia: $("#entryReaderMedia"),
    readerImage: $("#entryReaderImage"),
    readerTagsWrap: $("#entryReaderTagsWrap"),
    readerTags: $("#entryReaderTags"),
    readerSourcesWrap: $("#entryReaderSourcesWrap"),
    readerSources: $("#entryReaderSources"),
    btnReaderEdit: $("#btnReaderEdit"),
    btnReaderDelete: $("#btnReaderDelete"),

    imageDlg: $("#imageModal"),
    imageImg: $("#imageModalImg")
  };

  const deleteConfirm = {
    dlg: $("#deleteConfirmModal"),
    title: $("#deleteConfirmTitle"),
    copy: $("#deleteConfirmCopy"),
    detail: $("#deleteConfirmDetail")
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
  let createdByName = postName.trim();

  // Initialize PillInput components for tags and sources
  const entryTagsInput = new PillInput(ui.entryTags, {
    placeholder: "Type a tag and press Enter...",
    emptyMessage: "No tags yet.",
    maxLength: 20
  });
  
  const entrySourcesInput = new PillInput(ui.entrySources, {
    placeholder: "Type a source and press Enter...",
    emptyMessage: "No sources yet.",
    maxLength: 20
  });

  const getByline = (entry) =>
    entry?.createdByName
      || "Anonymous";

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

  function openImageViewer(url) {
    if (!url || !ui.imageDlg || !ui.imageImg) return;
    ui.imageImg.src = url;
    ui.imageDlg.showModal?.();
  }

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

      const imageList = getEntryImageUrls(e);
      const hasImages = imageList.length > 0;
      const initialImage = hasImages ? imageList[0] : "";
      const img = hasImages
        ? `<button class="thumb__image" type="button" data-thumb-action="expand" aria-label="View full image"><img class="thumb" src="${esc(initialImage)}" alt="Entry image" loading="lazy" /></button>`
        : `<div class="thumb__image" aria-disabled="true"><div class="thumb--empty">No image</div></div>`;
      const navDisabled = imageList.length < 2;
      const nav = `
        <div class="thumb__nav">
          <button class="thumb__btn" data-thumb-action="prev" type="button" ${navDisabled ? "disabled" : ""} aria-label="Previous image">&lt;</button>
          <button class="thumb__btn" data-thumb-action="next" type="button" ${navDisabled ? "disabled" : ""} aria-label="Next image">&gt;</button>
        </div>
      `;

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
          <button class="btn btn--outline" data-act="move-up" type="button" ${allowMoveUp ? "" : "disabled"}>
            <span class="ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m12 5l-6 6h4v6h4v-6h4z"/></svg>
            </span>
            Up
          </button>
          <button class="btn btn--outline" data-act="move-down" type="button" ${allowMoveDown ? "" : "disabled"}>
            <span class="ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m12 19l6-6h-4V7h-4v6H6z"/></svg>
            </span>
            Down
          </button>
        `
        : "";
      const editActions = allowEdit
        ? `
          <button class="btn btn--secondary" data-act="edit" type="button">
            <span class="ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="m4 15.5l8.8-8.8l2.5 2.5L6.5 18H4zM14.8 6.2l1.5-1.5a1 1 0 0 1 1.4 0l1.1 1.1a1 1 0 0 1 0 1.4l-1.5 1.5z"/></svg>
            </span>
            Edit
          </button>
          <button class="btn btn--danger" data-act="del" type="button">
            <span class="ico" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 3h6l1 2h5v2H3V5h5zm1 6h2v10h-2zm4 0h2v10h-2z"/></svg>
            </span>
            Delete
          </button>
        `
        : "";

      card.innerHTML = `
        <div class="card__row">
          <div class="thumb-cell">
            ${img}
            ${nav}
          </div>
          <div class="card__body">
            <div class="card__title">${esc(e.title || "Untitled")}</div>
            <div class="card__text">${esc((e.description || "").slice(0, 240))}${(e.description || "").length > 240 ? "…" : ""}</div>
            ${tagList}
            ${sourceList}
            <div class="card__meta">by ${esc(getByline(e))}</div>
            <div class="card__actions">
              <button class="btn btn--secondary" data-act="read" type="button">
                <span class="ico" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M4 5h12a2 2 0 0 1 2 2v11h-2V7H4zm4 4h12a2 2 0 0 1 2 2v10H8a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2m0 2v8h12v-8z"/></svg>
                </span>
                Read
              </button>
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
      const thumbImg = card.querySelector(".thumb");
      const expandBtn = card.querySelector('[data-thumb-action="expand"]');
      const prevBtn = card.querySelector('[data-thumb-action="prev"]');
      const nextBtn = card.querySelector('[data-thumb-action="next"]');

      let imageIndex = 0;
      const updateThumb = () => {
        if (!thumbImg || !imageList.length) return;
        imageIndex = (imageIndex + imageList.length) % imageList.length;
        thumbImg.src = imageList[imageIndex];
        thumbImg.alt = `Entry image ${imageIndex + 1} of ${imageList.length}`;
      };

      prevBtn?.addEventListener("click", () => {
        if (!imageList.length) return;
        imageIndex -= 1;
        updateThumb();
      });

      nextBtn?.addEventListener("click", () => {
        if (!imageList.length) return;
        imageIndex += 1;
        updateThumb();
      });

      expandBtn?.addEventListener("click", () => {
        if (!imageList.length) return;
        openImageViewer(imageList[imageIndex]);
      });

      if (imageList.length) {
        updateThumb();
      }
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
    ui.readerMeta.textContent = `by ${esc(getByline(entryData))}`;
    ui.readerDesc.innerHTML = renderMarkdown(entryData?.description || "");

    const primaryImageUrl = getPrimaryImageUrl(entryData);
    if (primaryImageUrl) {
      ui.readerImage.src = primaryImageUrl;
      ui.readerMedia.classList.remove("is-hidden");
      ui.reader.classList.remove("reader--no-media");
    } else {
      ui.readerMedia.classList.add("is-hidden");
      ui.readerImage.removeAttribute("src");
      ui.reader.classList.add("reader--no-media");
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
    
    // Set tags and sources using PillInput
    const tags = Array.isArray(entryData?.tags) ? entryData.tags : [];
    const sources = Array.isArray(entryData?.sources) ? entryData.sources : [];
    entryTagsInput.setItems(tags);
    entrySourcesInput.setItems(sources);
    
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
    const tags = entryTagsInput.getItems();
    const sources = entrySourcesInput.getItems();
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
          createdByName: createdByName || undefined
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

    const ok = await confirmDelete({
      title: "Delete this entry?",
      copy: "This will remove it from the compendium."
    });
    if (!ok) return;

    try {
      await deleteEntry(entry.id);
      toast("Deleted");
    } catch (e) {
      toast(e?.message || "Delete failed", "bad");
    }
  }

  function confirmDelete({ title, copy, detail }) {
    const fallbackMessage = [title, copy, detail].filter(Boolean).join("\n\n");
    if (!deleteConfirm.dlg?.showModal) {
      return Promise.resolve(confirm(fallbackMessage || "Delete?"));
    }

    deleteConfirm.title.textContent = title || "Delete";
    deleteConfirm.copy.textContent = copy || "";
    deleteConfirm.detail.textContent = detail || "";
    deleteConfirm.copy.classList.toggle("is-hidden", !copy);
    deleteConfirm.detail.classList.toggle("is-hidden", !detail);

    return new Promise((resolve) => {
      const handleClose = () => {
        deleteConfirm.dlg.removeEventListener("close", handleClose);
        resolve(deleteConfirm.dlg.returnValue === "confirm");
      };

      deleteConfirm.dlg.addEventListener("close", handleClose);
      deleteConfirm.dlg.showModal();
    });
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

  return {
    setActiveCompendium,
    setPostName(nextName) {
      createdByName = (nextName || "").trim();
    }
  };
}
