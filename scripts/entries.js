import {
	createEntry,
	deleteEntry,
	listenEntries,
	updateEntry,
} from "./firebase.js";
import { renderMarkdown, sanitizeUrl } from "./markdown.js";
import { PillInput } from "./pill-input.js";
import {
	getSourceDisplayText,
	getSourceEmoji,
	getSourceType,
	SourcePillInput,
} from "./source-pill-input.js";

const $ = (s, r = document) => r.querySelector(s);
function esc(s) {
	return (s ?? "").toString();
}
function normEmail(e) {
	return (e || "").trim().toLowerCase();
}
function escapeHtmlForReader(str) {
	return (str ?? "")
		.toString()
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

function toast(msg, kind = "ok") {
	const el = document.createElement("div");
	el.className = `toast toast--${kind}`;
	el.textContent = msg;
	document.body.appendChild(el);
	requestAnimationFrame(() => el.classList.add("is-on"));
	setTimeout(() => {
		el.classList.remove("is-on");
		setTimeout(() => el.remove(), 220);
	}, 2200);
}

function isOwner(user, comp) {
	return comp?.ownerUid === user.uid;
}
function isEditor(user, comp) {
	if (!comp || comp.visibility !== "public") return false;
	const emails = Array.isArray(comp.editorEmails) ? comp.editorEmails : [];
	return emails.includes(normEmail(user.email || ""));
}
function canAddEntry(user, comp) {
	if (!comp) return false;
	if (comp.visibility === "public") return true;
	return isOwner(user, comp);
}
function canEditEntry(user, comp, entry) {
	if (!entry) return false;
	if (entry.createdByUid === user.uid) return true;
	if (
		comp?.visibility === "public" &&
		(isOwner(user, comp) || isEditor(user, comp))
	)
		return true;
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
		entryImageDeleteWrap: $("#entryImageDeleteWrap"),
		btnDeleteSelectedImage: $("#btnDeleteSelectedImage"),

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
		readerIndexLabel: $("#entryReaderIndex"),
		btnReaderPrev: $("#btnReaderPrev"),
		btnReaderNext: $("#btnReaderNext"),
		readerTagsWrap: $("#entryReaderTagsWrap"),
		readerTags: $("#entryReaderTags"),
		readerSourcesWrap: $("#entryReaderSourcesWrap"),
		readerSources: $("#entryReaderSources"),
		btnReaderEdit: $("#btnReaderEdit"),
		btnReaderDelete: $("#btnReaderDelete"),

		imageDlg: $("#imageModal"),
		imageImg: $("#imageModalImg"),

		sourceDetailDlg: $("#sourceDetailModal"),
		sourceDetailTitle: $("#sourceDetailTitle"),
		sourceDetailType: $("#sourceDetailType"),
		sourceDetailContent: $("#sourceDetailContent"),
	};

	const deleteConfirm = {
		dlg: $("#deleteConfirmModal"),
		title: $("#deleteConfirmTitle"),
		copy: $("#deleteConfirmCopy"),
		detail: $("#deleteConfirmDetail"),
	};

	const missing = Object.entries(ui)
		.filter(([, el]) => !el)
		.map(([key]) => key);

	if (missing.length) {
		console.warn("Entries UI is missing expected elements:", missing);
		return {
			setActiveCompendium() {},
		};
	}

	let active = {
		scope: null,
		compId: null,
		compDoc: null,
	};

	let unsub = null;

	let editingId = null;
	let editingData = null;
	let imageUrls = [];
	let previewIndex = 0;
	let readerEntry = null;
	let readerScope = null;
	let readerImageUrls = [];
	let readerImageIndex = 0;
	let createdByName = postName.trim();
	let selectedImageIndex = null;
	let draggedImageIndex = null;

	// Initialize PillInput components for tags and sources
	const entryTagsInput = new PillInput(ui.entryTags, {
		placeholder: "Type a tag and press Enter...",
		emptyMessage: "No tags yet.",
		maxLength: 20,
	});

	const entrySourcesInput = new SourcePillInput(ui.entrySources, {
		placeholder: "Type a source and press Enter...",
		emptyMessage: "No sources yet.",
		maxLength: 20,
	});

	const getByline = (entry) => entry?.createdByName || "Anonymous";

	ui.entryUrlInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter") {
			event.preventDefault();
			addImageUrlFromInput();
		}
	});
	ui.btnAddEntryImageUrl.addEventListener("click", addImageUrlFromInput);
	ui.entryImageUrlsList.addEventListener("click", handleImageUrlListClick);
	ui.entryImageUrlsList.addEventListener("keydown", handleImageUrlListKeydown);
	ui.btnDeleteSelectedImage?.addEventListener("click", deleteSelectedImage);
	ui.btnPreviewPrev.addEventListener("click", () => changePreviewIndex(-1));
	ui.btnPreviewNext.addEventListener("click", () => changePreviewIndex(1));

	ui.btnReaderPrev.addEventListener("click", () => changeReaderImageIndex(-1));
	ui.btnReaderNext.addEventListener("click", () => changeReaderImageIndex(1));

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
		if (scope === "personal")
			ui.btnAddPersonal.disabled = !canAddEntry(user, compDoc);
		if (scope === "public")
			ui.btnAddPublic.disabled = !canAddEntry(user, compDoc);

		unsub = listenEntries(
			compId,
			(entries) => {
				if (scope === "personal") {
					ui.personalCount.textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
					render(entries, "personal");
				} else {
					ui.publicCount.textContent = `${entries.length} entr${entries.length === 1 ? "y" : "ies"}`;
					render(entries, "public");
				}
			},
			(err) => {
				console.error(err);
				toast(err?.message || "Failed to load entries", "bad");
			},
		);
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
			const allowMoveUp =
				allowEdit && prevEntry && canEditEntry(user, comp, prevEntry);
			const allowMoveDown =
				allowEdit && nextEntry && canEditEntry(user, comp, nextEntry);
			const tags = Array.isArray(e.tags) ? e.tags : [];
			const sources = Array.isArray(e.sources) ? e.sources : [];
			const tagList = tags.length
				? `<div class="card__tags">${tags.map((tag) => `<span class="card__tag">${esc(tag)}</span>`).join("")}</div>`
				: "";
			const sourceList = sources.length
				? `<div class="card__sources"><span class="card__sources-label">Sources:</span> ${sources
						.map((source) => {
							const emoji = getSourceEmoji(getSourceType(source));
							const text = getSourceDisplayText(source);
							return `<span class="card__source"><span class="card__source-emoji">${emoji}</span>${esc(text)}</span>`;
						})
						.join("")}</div>`
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

			card
				.querySelector('[data-act="read"]')
				.addEventListener("click", () => openReader(scope, e));
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

		readerImageUrls = getEntryImageUrls(entryData);
		readerImageIndex = 0;
		updateReaderGallery();

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
				const emoji = getSourceEmoji(getSourceType(source));
				const text = getSourceDisplayText(source);
				item.innerHTML = `<span class="reader__source-emoji">${emoji}</span>${escapeHtmlForReader(text)}`;

				const sourceType = getSourceType(source);
				const sourceUrl = source?.url;
				const sanitizedUrl = sourceUrl ? sanitizeUrl(sourceUrl) : null;

				// Add hover tooltip for web sources with URLs
				if (sanitizedUrl && sourceType === "web") {
					item.title = sanitizedUrl;
				}

				// Make source clickable
				item.addEventListener("click", () => {
					// For web sources with valid URLs, show confirmation dialog
					if (sourceType === "web" && sanitizedUrl) {
						const confirmed = confirm(
							`You are being redirected to an external website:\n\n${sanitizedUrl}\n\nDo you want to continue?`,
						);
						if (confirmed) {
							window.open(sanitizedUrl, "_blank", "noopener,noreferrer");
						}
					} else {
						// For other sources or sources without URLs, show detail modal
						openSourceDetail(source);
					}
				});

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

	function updateReaderGallery() {
		const hasImages = readerImageUrls.length > 0;
		readerImageIndex = Math.max(
			0,
			Math.min(readerImageIndex, readerImageUrls.length - 1),
		);
		const currentImageUrl = readerImageUrls[readerImageIndex] || "";

		if (currentImageUrl && hasImages) {
			ui.readerImage.src = currentImageUrl;
			ui.readerMedia.classList.remove("is-hidden");
			ui.reader.classList.remove("reader--no-media");
		} else {
			ui.readerMedia.classList.add("is-hidden");
			ui.readerImage.removeAttribute("src");
			ui.reader.classList.add("reader--no-media");
		}

		ui.readerIndexLabel.textContent = hasImages
			? `${readerImageIndex + 1}/${readerImageUrls.length}`
			: "0/0";
		const disableNav = readerImageUrls.length < 2;
		ui.btnReaderPrev.disabled = disableNav;
		ui.btnReaderNext.disabled = disableNav;
	}

	function changeReaderImageIndex(delta) {
		if (!readerImageUrls.length) return;
		if (readerImageUrls.length === 1) {
			readerImageIndex = 0;
		} else {
			readerImageIndex =
				(readerImageIndex + delta + readerImageUrls.length) %
				readerImageUrls.length;
		}
		updateReaderGallery();
	}

	function openSourceDetail(source) {
		if (!source || !ui.sourceDetailDlg) return;

		const sourceType = getSourceType(source);
		const sourceText = getSourceDisplayText(source);
		const sourceEmoji = getSourceEmoji(sourceType);

		// Set modal title
		ui.sourceDetailTitle.textContent = sourceText || "Source";
		ui.sourceDetailType.textContent = `${sourceEmoji} ${sourceType.charAt(0).toUpperCase() + sourceType.slice(1)}`;

		// Build source details HTML
		let detailsHtml = "";

		// Always show the main text
		if (sourceText) {
			detailsHtml += `
        <div class="source-detail__field">
          <div class="source-detail__label">Title/Name</div>
          <div class="source-detail__value">${escapeHtmlForReader(sourceText)}</div>
        </div>
      `;
		}

		// Get type-specific fields based on SOURCE_TYPES from source-pill-input.js
		const typeFields = {
			web: ["url", "siteName", "accessDate"],
			book: ["author", "publisher", "year", "pages", "isbn"],
			essay: ["author", "publication", "date"],
			video: ["url", "creator", "timestamp"],
			audio: ["url", "creator", "episode", "timestamp"],
			person: ["role", "organization", "contactDate"],
		};

		const fields = typeFields[sourceType] || [];
		const fieldLabels = {
			url: "URL",
			siteName: "Site Name",
			accessDate: "Access Date",
			author: "Author",
			publisher: "Publisher",
			year: "Year",
			pages: "Pages",
			isbn: "ISBN",
			publication: "Publication",
			date: "Date",
			creator: "Creator",
			timestamp: "Timestamp",
			episode: "Episode",
			role: "Role/Title",
			organization: "Organization",
			contactDate: "Contact Date",
		};

		fields.forEach((fieldName) => {
			const fieldValue = source[fieldName];
			if (fieldValue) {
				const label = fieldLabels[fieldName] || fieldName;

				if (fieldName === "url") {
					// Sanitize URL and display as non-clickable text
					const sanitized = sanitizeUrl(fieldValue);
					if (sanitized) {
						detailsHtml += `
              <div class="source-detail__field">
                <div class="source-detail__label">${escapeHtmlForReader(label)}</div>
                <div class="source-detail__value source-detail__url">${escapeHtmlForReader(sanitized)}</div>
                <div class="source-detail__url-warning">⚠️ Copy and paste this URL into your browser. Do not click directly.</div>
              </div>
            `;
					} else {
						// Invalid URL - show as plain text
						detailsHtml += `
              <div class="source-detail__field">
                <div class="source-detail__label">${escapeHtmlForReader(label)}</div>
                <div class="source-detail__value">${escapeHtmlForReader(fieldValue)} (Invalid URL)</div>
              </div>
            `;
					}
				} else {
					// Regular field
					detailsHtml += `
            <div class="source-detail__field">
              <div class="source-detail__label">${escapeHtmlForReader(label)}</div>
              <div class="source-detail__value">${escapeHtmlForReader(fieldValue)}</div>
            </div>
          `;
				}
			}
		});

		ui.sourceDetailContent.innerHTML = detailsHtml;
		ui.sourceDetailDlg.showModal?.();
	}

	function openModal(_scope, entryId, entryData) {
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
		selectedImageIndex = null;
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

		ui.previewIndexLabel.textContent = hasImages
			? `${previewIndex + 1}/${imageUrls.length}`
			: "0/0";
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

		if (!title || !description)
			return showError("Title and details are required.");

		if (!editingId && !canAddEntry(user, active.compDoc))
			return showError("You cannot add entries here.");
		if (editingId && !canEditEntry(user, active.compDoc, editingData))
			return showError("You cannot edit this entry.");

		try {
			const imageUrlsToSave = [...imageUrls];

			if (editingId) {
				await updateEntry(editingId, {
					title,
					description,
					imageUrls: imageUrlsToSave,
					tags,
					sources,
				});
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
					createdByName: createdByName || undefined,
				});
				toast("Entry created");
			}

			ui.dlg.close?.();
		} catch (e) {
			showError(e?.message || "Save failed");
		}
	}

	function getEntryImageUrls(entryData) {
		if (!entryData) return [];
		const urls = Array.isArray(entryData.imageUrls) ? entryData.imageUrls : [];
		if (urls.length) return urls.filter(Boolean);
		if (entryData.imageUrl) return [entryData.imageUrl];
		return [];
	}

	function getEntryOrderValue(entryData, index) {
		if (typeof entryData?.order === "number") return entryData.order;
		if (typeof entryData?.createdAt?.toMillis === "function")
			return entryData.createdAt.toMillis();
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

	function handleImageUrlListClick(event) {
		const row = event.target.closest("[data-image-index]");
		if (!row) return;
		const index = Number(row.dataset.imageIndex);
		if (Number.isNaN(index)) return;

		selectedImageIndex = index;
		renderImageUrlList();
	}

	function handleImageUrlListKeydown(event) {
		if (imageUrls.length === 0) return;

		// Arrow keys for navigation
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			if (selectedImageIndex === null) {
				selectedImageIndex = 0;
			} else if (event.key === "ArrowDown") {
				selectedImageIndex = Math.min(
					selectedImageIndex + 1,
					imageUrls.length - 1,
				);
			} else {
				selectedImageIndex = Math.max(selectedImageIndex - 1, 0);
			}
			renderImageUrlList();
			return;
		}

		// Delete key to delete selected
		if (event.key === "Delete" && selectedImageIndex !== null) {
			event.preventDefault();
			deleteSelectedImage();
			return;
		}

		// Ctrl+ArrowUp/Down to move items
		if (
			(event.key === "ArrowUp" || event.key === "ArrowDown") &&
			(event.ctrlKey || event.metaKey)
		) {
			event.preventDefault();
			if (selectedImageIndex === null) return;

			const delta = event.key === "ArrowUp" ? -1 : 1;
			const targetIndex = selectedImageIndex + delta;
			if (targetIndex < 0 || targetIndex >= imageUrls.length) return;

			const updated = [...imageUrls];
			const [item] = updated.splice(selectedImageIndex, 1);
			updated.splice(targetIndex, 0, item);
			imageUrls = updated;
			selectedImageIndex = targetIndex;

			renderImageUrlList();
			updatePreview();
			return;
		}
	}

	function handleImageDragStart(event) {
		const row = event.target.closest("[data-image-index]");
		if (!row) return;
		const index = Number(row.dataset.imageIndex);
		if (Number.isNaN(index)) return;
		draggedImageIndex = index;
		event.dataTransfer.effectAllowed = "move";
		event.dataTransfer.setData("text/plain", draggedImageIndex.toString());
		row.classList.add("is-dragging");
	}

	function handleImageDragOver(event) {
		event.preventDefault();
		event.dataTransfer.dropEffect = "move";
	}

	function handleImageDragEnter(event) {
		const row = event.target.closest("[data-image-index]");
		if (row && !row.classList.contains("is-dragging")) {
			row.classList.add("drag-over");
		}
	}

	function handleImageDragLeave(event) {
		const row = event.target.closest("[data-image-index]");
		if (row && (!event.relatedTarget || !row.contains(event.relatedTarget))) {
			row.classList.remove("drag-over");
		}
	}

	function handleImageDrop(event) {
		event.preventDefault();
		event.stopPropagation();

		const row = event.target.closest("[data-image-index]");
		if (!row) return;

		const dropIndex = Number(row.dataset.imageIndex);
		if (
			Number.isNaN(dropIndex) ||
			draggedImageIndex === null ||
			draggedImageIndex === dropIndex
		)
			return;

		// Reorder the array
		const updated = [...imageUrls];
		const [item] = updated.splice(draggedImageIndex, 1);
		updated.splice(dropIndex, 0, item);
		imageUrls = updated;

		// Update selected index if necessary
		if (selectedImageIndex === draggedImageIndex) {
			selectedImageIndex = dropIndex;
		} else if (selectedImageIndex !== null) {
			if (
				draggedImageIndex < selectedImageIndex &&
				dropIndex >= selectedImageIndex
			) {
				selectedImageIndex--;
			} else if (
				draggedImageIndex > selectedImageIndex &&
				dropIndex <= selectedImageIndex
			) {
				selectedImageIndex++;
			}
		}

		// Update preview index if necessary
		if (previewIndex === draggedImageIndex) {
			previewIndex = dropIndex;
		} else if (draggedImageIndex < previewIndex && dropIndex >= previewIndex) {
			previewIndex--;
		} else if (draggedImageIndex > previewIndex && dropIndex <= previewIndex) {
			previewIndex++;
		}

		renderImageUrlList();
		updatePreview();
	}

	function handleImageDragEnd() {
		const rows = ui.entryImageUrlsList.querySelectorAll("[data-image-index]");
		rows.forEach((row) => {
			row.classList.remove("is-dragging", "drag-over");
		});
		draggedImageIndex = null;
	}

	function deleteSelectedImage() {
		if (
			selectedImageIndex === null ||
			selectedImageIndex < 0 ||
			selectedImageIndex >= imageUrls.length
		) {
			return;
		}
		removeImageUrl(selectedImageIndex);
	}

	function removeImageUrl(index) {
		imageUrls = imageUrls.filter((_, idx) => idx !== index);

		// Update selectedImageIndex
		if (selectedImageIndex !== null) {
			if (selectedImageIndex === index) {
				selectedImageIndex = null;
			} else if (selectedImageIndex > index) {
				selectedImageIndex--;
			}
		}

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
			previewIndex =
				(previewIndex + delta + imageUrls.length) % imageUrls.length;
		}
		updatePreview();
	}

	function renderImageUrlList() {
		ui.entryImageUrlsList.innerHTML = "";
		ui.entryImageUrlsEmpty.classList.toggle("is-hidden", imageUrls.length > 0);
		ui.entryImageDeleteWrap?.classList.toggle(
			"is-hidden",
			imageUrls.length === 0,
		);

		// Set ARIA attributes and make list focusable for keyboard navigation
		if (imageUrls.length > 0) {
			ui.entryImageUrlsList.setAttribute("tabindex", "0");
			ui.entryImageUrlsList.setAttribute("role", "listbox");
			ui.entryImageUrlsList.setAttribute("aria-multiselectable", "false");
		} else {
			ui.entryImageUrlsList.removeAttribute("tabindex");
			ui.entryImageUrlsList.removeAttribute("role");
			ui.entryImageUrlsList.removeAttribute("aria-multiselectable");
		}

		imageUrls.forEach((url, index) => {
			const row = document.createElement("div");
			row.className = "entry-image-item";
			row.setAttribute("draggable", "true");
			row.setAttribute("data-image-index", index);
			row.setAttribute("role", "option");
			row.setAttribute("aria-label", `Image URL ${index + 1}`);

			if (selectedImageIndex === index) {
				row.classList.add("is-selected");
				row.setAttribute("aria-selected", "true");
			} else {
				row.setAttribute("aria-selected", "false");
			}

			const indexLabel = document.createElement("span");
			indexLabel.className = "entry-image-item__index";
			indexLabel.textContent = `${index + 1}) `;

			const urlText = document.createElement("span");
			urlText.className = "entry-image-item__url";
			urlText.textContent = url;
			urlText.title = url;

			row.appendChild(indexLabel);
			row.appendChild(urlText);

			// Add drag event listeners
			row.addEventListener("dragstart", handleImageDragStart);
			row.addEventListener("dragover", handleImageDragOver);
			row.addEventListener("dragenter", handleImageDragEnter);
			row.addEventListener("dragleave", handleImageDragLeave);
			row.addEventListener("drop", handleImageDrop);
			row.addEventListener("dragend", handleImageDragEnd);

			ui.entryImageUrlsList.appendChild(row);
		});
	}

	async function remove(entry) {
		if (!canEditEntry(user, active.compDoc, entry))
			return toast("Not allowed", "bad");

		const ok = await confirmDelete({
			title: "Delete this entry?",
			copy: "This will remove it from the compendium.",
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
		if (
			!canEditEntry(user, active.compDoc, entry) ||
			!canEditEntry(user, active.compDoc, targetEntry)
		) {
			toast("Not allowed", "bad");
			return;
		}
		const entryOrder = getEntryOrderValue(entry, index);
		const targetOrder = getEntryOrderValue(targetEntry, targetIndex);
		try {
			await Promise.all([
				updateEntry(entry.id, { order: targetOrder }),
				updateEntry(targetEntry.id, { order: entryOrder }),
			]);
		} catch (e) {
			toast(e?.message || "Reorder failed", "bad");
		}
	}

	return {
		setActiveCompendium,
		setPostName(nextName) {
			createdByName = (nextName || "").trim();
		},
	};
}
