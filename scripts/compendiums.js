import {
	addCompendiumEditor,
	createCompendium,
	deleteCompendium,
	listenEntries,
	listenEntriesByUserAccess,
	listenPersonalCompendiums,
	listenPublicCompendiums,
	removeCompendiumEditor,
	updateCompendium,
	updateCompendiumsByOwnerDisplayName,
} from "./firebase.js";
import { renderMarkdown } from "./markdown.js";
import { PillInput } from "./pill-input.js";
import {
	getSourceDisplayText,
	getSourceEmoji,
	getSourceType,
} from "./source-pill-input.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

function esc(s) {
	return (s ?? "").toString();
}
function normEmail(e) {
	return (e || "").trim().toLowerCase();
}
function isValidEmail(e) {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}
function parseTags(raw) {
	return (raw || "")
		.split(",")
		.map((x) => x.trim())
		.filter(Boolean)
		.slice(0, 40);
}
function getByline(entry) {
	return (
		entry?.createdByName ||
		entry?.createdByEmail ||
		entry?.createdByUid ||
		"unknown"
	);
}
function getEntryImageUrls(entry) {
	if (!entry) return [];
	const urls = Array.isArray(entry.imageUrls) ? entry.imageUrls : [];
	if (urls.length) return urls.filter(Boolean);
	if (entry.imageUrl) return [entry.imageUrl];
	return [];
}
function getPrimaryImageUrl(entry) {
	const urls = getEntryImageUrls(entry);
	return urls[0] || "";
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

function isPermissionDenied(err) {
	return err?.code === "permission-denied";
}

function stableSeed() {
	// Stable-enough random seed for covers (stored in doc)
	return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function ensureOwnerFields(comp, user, ownerName, updates) {
	const next = { ...updates };
	const isOwnerUser =
		(comp?.ownerUid && comp.ownerUid === user.uid) ||
		(!comp?.ownerUid && user?.uid);
	if (!comp?.ownerUid && user?.uid) next.ownerUid = user.uid;
	if (isOwnerUser && ownerName && comp?.ownerName !== ownerName) {
		next.ownerName = ownerName;
	}
	return next;
}

function coverUrlFor(comp) {
	if (comp?.coverUrl) return comp.coverUrl;
	const seed = comp?.coverSeed || comp?.id || "compendium";
	return `https://picsum.photos/seed/${encodeURIComponent(seed)}/900/650`;
}

function isOwner(user, comp) {
	return comp?.ownerUid === user.uid;
}
function isEditor(user, comp) {
	if (!comp || comp.visibility !== "public") return false;
	const emails = Array.isArray(comp.editorEmails) ? comp.editorEmails : [];
	return emails.includes(normEmail(user.email || ""));
}
function canEditCompendium(user, comp) {
	if (!comp) return false;
	if (comp.visibility === "personal") return isOwner(user, comp);
	return isOwner(user, comp) || isEditor(user, comp);
}
function canManageEditors(user, comp) {
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

export function initCompendiums({ user, ownerName = "", onSelectCompendium }) {
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
		cover: $("#personalCompCover"),
		tags: $("#personalCompTags"),

		btnSave: $("#btnSavePersonalCompendium"),
		btnToggleVisibility: $("#btnTogglePersonalVisibility"),
		btnRead: $("#btnReadPersonalCompendium"),
		btnDelete: $("#btnDeleteCompendium"),
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
		cover: $("#publicCompCover"),
		tags: $("#publicCompTags"),

		editHint: $("#publicEditHint"),
		btnSave: $("#btnSavePublicCompendium"),
		btnToggleVisibility: $("#btnTogglePublicVisibility"),
		btnRead: $("#btnReadPublicCompendium"),
		btnDelete: $("#btnDeletePublicCompendium"),

		editorsSection: $("#editorsSection"),
		editorInput: $("#editorEmailInput"),
		btnAddEditor: $("#btnAddEditor"),
		editorChips: $("#editorChips"),
	};

	const imageViewer = {
		dlg: $("#imageModal"),
		img: $("#imageModalImg"),
	};

	function openImageViewer(url) {
		if (!url || !imageViewer.dlg || !imageViewer.img) return;
		imageViewer.img.src = url;
		imageViewer.dlg.showModal?.();
	}

	// Modal
	const modal = {
		dlg: $("#newCompModal"),
		form: $("#newCompForm"),
		err: $("#newCompError"),
		name: $("#newCompName"),
		topic: $("#newCompTopic"),
		desc: $("#newCompDesc"),
		typeToggle: $("#newCompTypeToggle"),
		typeHint: $("#newCompTypeHint"),
		btnCreate: $("#btnCreateComp"),
	};

	const visibilityConfirm = {
		dlg: $("#visibilityConfirmModal"),
		title: $("#visibilityConfirmTitle"),
		copy: $("#visibilityConfirmCopy"),
		detail: $("#visibilityConfirmDetail"),
	};

	const deleteConfirm = {
		dlg: $("#deleteConfirmModal"),
		title: $("#deleteConfirmTitle"),
		copy: $("#deleteConfirmCopy"),
		detail: $("#deleteConfirmDetail"),
	};

	const listView = {
		list: $("#compendiumList"),
		count: $("#compendiumCount"),
		search: $("#compendiumSearch"),
		visibility: $("#compendiumVisibility"),
		sort: $("#compendiumSort"),
		viewMode: $("#compendiumViewMode"),
	};

	const linksView = {
		personalCompendiums: $("#personalLinksCompendiums"),
		personalEntries: $("#personalLinksEntries"),
		publicCompendiums: $("#publicLinksCompendiums"),
		publicEntries: $("#publicLinksEntries"),
	};

	const readerView = {
		empty: $("#readerEmpty"),
		content: $("#readerContent"),
		cover: $("#readerCover"),
		visibility: $("#readerVisibility"),
		title: $("#readerTitle"),
		topic: $("#readerTopic"),
		description: $("#readerDescription"),
		toc: $("#readerToc"),
		tocList: $("#readerTocList"),
		entriesCount: $("#readerEntriesCount"),
		entriesList: $("#readerEntriesList"),
		btnBackToDetail: $("#btnReaderBackToDetail"),
		btnEdit: $("#btnReaderEditCompendium"),
		btnDelete: $("#btnReaderDeleteCompendium"),
	};

	// --- State ---
	let personalUnsub = null;
	let publicUnsub = null;
	let entriesUnsub = null;
	let readerEntriesUnsub = null;

	let personalItems = [];
	let publicItems = [];
	let entryItems = [];

	let selectedCompendium = null;
	let selectedScope = "personal";
	const filterState = {
		search: "",
		visibility: "all",
		sort: "recent",
		viewMode: "book",
	};
	let ignoreTypeConfirm = false;
	let currentOwnerName = ownerName || "";

	// Initialize PillInput components for tags
	const personalTagsInput = new PillInput(personal.tags, {
		placeholder: "Type a tag and press Enter...",
		emptyMessage: "No tags yet.",
		maxLength: 20,
	});

	const publicTagsInput = new PillInput(pub.tags, {
		placeholder: "Type a tag and press Enter...",
		emptyMessage: "No tags yet.",
		maxLength: 20,
	});

	async function syncOwnerDisplayName(nextName) {
		currentOwnerName = nextName || "";
		if (!currentOwnerName) return;
		try {
			await updateCompendiumsByOwnerDisplayName(user.uid, currentOwnerName);
		} catch (err) {
			console.error(err);
			toast(err?.message || "Failed to update owner display name", "bad");
		}
	}

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
		if (modal.typeToggle) {
			ignoreTypeConfirm = true;
			modal.typeToggle.checked = false;
			updateNewCompTypeHint();
			ignoreTypeConfirm = false;
		}
		modal.dlg.showModal?.();
	});

	modal.form.addEventListener("submit", (event) => {
		if (event.submitter?.value === "cancel") {
			return;
		}
		event.preventDefault();
		createFromModal();
	});

	if (modal.typeToggle) {
		modal.typeToggle.addEventListener("change", () => {
			if (ignoreTypeConfirm) {
				updateNewCompTypeHint();
				return;
			}
			const isPublic = modal.typeToggle.checked;
			const ok = confirm(
				isPublic
					? "Make this a public compendium?\n\nAnyone can view it. Any logged-in user can add entries."
					: "Make this a personal compendium?\n\nOnly you can access and edit it.",
			);
			if (!ok) {
				ignoreTypeConfirm = true;
				modal.typeToggle.checked = !isPublic;
				ignoreTypeConfirm = false;
			}
			updateNewCompTypeHint();
		});
	}

	personal.btnSave.addEventListener("click", () => saveCompendium("personal"));
	personal.btnToggleVisibility.addEventListener("click", () =>
		toggleCompendiumVisibility("personal"),
	);
	personal.btnDelete.addEventListener("click", () =>
		removeCompendium("personal"),
	);

	pub.btnSave.addEventListener("click", () => saveCompendium("public"));
	pub.btnToggleVisibility.addEventListener("click", () =>
		toggleCompendiumVisibility("public"),
	);
	pub.btnDelete.addEventListener("click", () => removeCompendium("public"));

	personal.btnRead.addEventListener("click", () =>
		openReaderForScope("personal"),
	);
	pub.btnRead.addEventListener("click", () => openReaderForScope("public"));

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

	readerView.btnBackToDetail.addEventListener("click", () =>
		goToRoute("compendium-detail"),
	);
	readerView.btnEdit.addEventListener("click", () =>
		goToRoute("compendium-detail"),
	);
	readerView.btnDelete.addEventListener("click", () => {
		if (!selectedCompendium?.doc) return;
		removeCompendium(selectedCompendium.doc.visibility);
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
	syncOwnerDisplayName(currentOwnerName);
	listenPersonal();
	listenPublic();
	listenEntriesAccess();

	function listenPersonal() {
		personalUnsub?.();
		personalUnsub = listenPersonalCompendiums(
			user.uid,
			(items) => {
				personalItems = items.map((item) =>
					normalizeCompendium(item, "personal"),
				);
				syncSelected();
				renderCombinedList();
				renderLinks();
			},
			(err) => {
				console.error(err);
				toast(err?.message || "Failed to load personal compendiums", "bad");
			},
		);
	}

	function listenPublic() {
		publicUnsub?.();
		publicUnsub = listenPublicCompendiums(
			(items) => {
				publicItems = items.map((item) => normalizeCompendium(item, "public"));
				syncSelected();
				renderCombinedList();
				renderLinks();
			},
			(err) => {
				console.error(err);
				if (isPermissionDenied(err)) {
					publicItems = [];
					syncSelected();
					renderCombinedList();
					renderLinks();
					return;
				}
				toast(err?.message || "Failed to load public compendiums", "bad");
			},
		);
	}

	function listenEntriesAccess() {
		entriesUnsub?.();
		entriesUnsub = listenEntriesByUserAccess(
			user.uid,
			(items) => {
				entryItems = items;
				renderLinks();
			},
			(err) => {
				console.error(err);
				if (isPermissionDenied(err)) {
					entryItems = [];
					renderLinks();
					return;
				}
				toast(err?.message || "Failed to load link entries", "bad");
			},
		);
	}

	function normalizeCompendium(item, fallbackVisibility) {
		return {
			...item,
			visibility: item.visibility || fallbackVisibility,
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
		// First try to find with matching visibility
		let found = allItems.find(
			(item) => item.id === selectedCompendium.id && item.visibility === scope,
		);
		// If not found, try to find by ID only (handles visibility changes)
		if (!found) {
			found = allItems.find((item) => item.id === selectedCompendium.id);
		}
		if (found) {
			selectedCompendium = { id: found.id, doc: found };
			// Update selectedScope to match the found item's actual visibility
			selectedScope = found.visibility;
			showDetailPanel(found.visibility);
			paintEditor(found.visibility);
			renderReader(found);
			onSelectCompendium?.(found.visibility, found.id, found);
		} else {
			selectedCompendium = null;
			showDetailPanel(selectedScope);
			paintEditor(selectedScope);
			renderReader(null);
			onSelectCompendium?.(selectedScope, null, null);
		}
	}

	function renderCombinedList() {
		const allItems = [...personalItems, ...publicItems];
		const filteredItems = filterCompendiums(allItems);
		listView.count.textContent = fmtCount(filteredItems.length, "compendium");
		renderPicker(
			listView.list,
			filteredItems,
			allItems.length,
			filterState.viewMode,
		);
	}

	function renderLinks() {
		const allCompendiums = [...personalItems, ...publicItems];
		renderLinksForScope(
			linksView.personalCompendiums,
			linksView.personalEntries,
			allCompendiums,
		);
		renderLinksForScope(
			linksView.publicCompendiums,
			linksView.publicEntries,
			allCompendiums,
		);
	}

	function renderLinksForScope(compendiumRoot, entryRoot, allCompendiums) {
		if (!compendiumRoot || !entryRoot) return;

		const byId = new Map(allCompendiums.map((item) => [item.id, item]));
		const sortedCompendiums = [...allCompendiums].sort((a, b) =>
			(a.name || "").localeCompare(b.name || ""),
		);

		renderLinkList(compendiumRoot, sortedCompendiums, (comp) => {
			const accessible = canAccessCompendium(user, comp);
			return {
				label: comp.name || "Untitled",
				meta:
					comp.topic ||
					(comp.visibility === "public"
						? "Public compendium"
						: "Personal compendium"),
				accessible,
				active:
					selectedCompendium?.id === comp.id &&
					selectedCompendium?.doc?.visibility === comp.visibility,
				onClick: () => selectCompendium(comp, { navigate: true }),
			};
		});

		const sortedEntries = [...entryItems].sort(
			(a, b) => entryTimestamp(b) - entryTimestamp(a),
		);
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
				},
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
			d.textContent =
				totalCount === 0
					? "No compendiums yet — click New to create one."
					: "No compendiums match your filters.";
			root.appendChild(d);
			return;
		}

		for (const c of items) {
			const isActive =
				selectedCompendium?.id === c.id &&
				selectedCompendium?.doc?.visibility === c.visibility;
			const hasCover = Boolean(c.coverUrl);
			const cover = hasCover ? coverUrlFor(c) : "";
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className = `cp-card${viewMode === "list" ? " cp-card--list" : ""}${!hasCover && viewMode !== "list" ? " cp-card--no-cover" : ""}${isActive ? " is-active" : ""}`;

			const desc = (c.description || "").trim() || "No description yet.";
			const topic = (c.topic || "").trim();

			if (viewMode === "list") {
				btn.innerHTML = `
          <div class="cp-list">
            <div class="cp-title">${esc(c.name || "Untitled")}</div>
            <div class="cp-meta">${esc(topic) || "No subtitle"}</div>
            <div class="cp-copy">${esc(desc)}</div>
          </div>
        `;
			} else {
				const coverMarkup = hasCover
					? `<div class="cp-media"><img src="${esc(cover)}" alt="${esc(c.name || "Compendium")} cover" loading="lazy" /></div>`
					: `<div class="cp-media cp-media--empty"><span>No cover</span></div>`;
				btn.innerHTML = `
          ${coverMarkup}
          <div class="cp-content">
            <div class="cp-top">
              <h2 class="cp-title">${esc(c.name || "Untitled")}</h2>
              <div class="cp-pill">${c.visibility === "public" ? "Public" : "Personal"}</div>
            </div>
            <div class="cp-meta">${esc(topic)}</div>
            <p class="cp-copy">${esc(desc)}</p>
            <div class="cp-btn">Open Compendium</div>
          </div>
        `;
			}

			btn.addEventListener("click", () => {
				selectCompendium(c, { navigate: true });
			});
			root.appendChild(btn);
		}
	}

	function filterCompendiums(items) {
		const query = filterState.search;
		const visibility = filterState.visibility;
		const sort = filterState.sort;

		let filtered = items;

		if (visibility !== "all") {
			filtered = filtered.filter((item) => item.visibility === visibility);
		}

		if (query) {
			filtered = filtered.filter((item) => matchesSearch(item, query));
		}

		return [...filtered].sort((a, b) => sortCompendiums(a, b, sort));
	}

	function matchesSearch(item, query) {
		const haystack = [item.name, item.topic, item.description]
			.filter(Boolean)
			.join(" ")
			.toLowerCase();
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
		const stamp =
			item.updatedAt ?? item.createdAt ?? item.updated_at ?? item.created_at;
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
		const stamp =
			item.updatedAt ?? item.createdAt ?? item.updated_at ?? item.created_at;
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
		renderLinks();
		renderReader(comp);

		const scope = comp?.visibility || selectedScope;
		onSelectCompendium?.(scope, comp?.id || null, comp || null);

		const editable = comp ? canEditCompendium(user, comp) : false;
		if (comp && !editable) {
			goToRoute("compendium-reader");
			return;
		}

		showDetailPanel(selectedScope);
		paintEditor(selectedScope);

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

	function openReaderForScope(scope) {
		const { id: compId, doc: comp } = getSelectedForScope(scope);
		if (!compId || !comp) return;
		selectCompendium(comp, { navigate: false });
		goToRoute("compendium-reader");
	}

	function renderReader(comp) {
		readerEntriesUnsub?.();
		readerEntriesUnsub = null;

		if (!comp) {
			readerView.entriesList.innerHTML = "";
			readerView.entriesCount.textContent = "—";
			readerView.empty.classList.remove("is-hidden");
			readerView.content.classList.add("is-hidden");
			return;
		}

		readerView.empty.classList.add("is-hidden");
		readerView.content.classList.remove("is-hidden");

		readerView.cover.src = coverUrlFor(comp);
		readerView.cover.alt = `${comp.name || "Compendium"} cover`;
		readerView.visibility.textContent =
			comp.visibility === "public"
				? "Public compendium"
				: "Personal compendium";
		readerView.title.textContent = comp.name || "Untitled";
		readerView.topic.textContent = comp.topic
			? `Subtitle: ${comp.topic}`
			: "No subtitle set";
		readerView.description.innerHTML = renderMarkdown(
			(comp.description || "").trim() || "No description yet.",
		);

		const editable = canEditCompendium(user, comp);
		const owner = isOwner(user, comp);
		readerView.btnEdit.classList.toggle("is-hidden", !editable);
		readerView.btnBackToDetail.classList.toggle("is-hidden", !editable);
		readerView.btnDelete.classList.toggle("is-hidden", !owner);
		readerView.btnEdit.disabled = !editable;
		readerView.btnBackToDetail.disabled = !editable;
		readerView.btnDelete.disabled = !owner;
		readerView.btnDelete.title = owner ? "" : "Owner only";

		readerEntriesUnsub = listenEntries(
			comp.id,
			(entries) => {
				renderReaderEntries(entries);
			},
			(err) => {
				console.error(err);
				toast(err?.message || "Failed to load entries", "bad");
			},
		);
	}

	function renderReaderEntries(entries) {
		readerView.entriesList.innerHTML = "";
		readerView.tocList.innerHTML = "";
		readerView.entriesCount.textContent = fmtCount(entries.length, "entry");

		if (!entries.length) {
			readerView.toc.classList.add("is-hidden");
			const empty = document.createElement("div");
			empty.className = "subtle";
			empty.textContent = "No entries yet.";
			readerView.entriesList.appendChild(empty);
			return;
		}

		// Show TOC and populate it
		readerView.toc.classList.remove("is-hidden");
		entries.forEach((entry, index) => {
			const li = document.createElement("li");
			li.className = "reader__toc-item";
			const link = document.createElement("a");
			link.className = "reader__toc-link";
			link.href = `#reader-entry-${index}`;
			link.textContent = entry.title || "Untitled";
			link.addEventListener("click", (e) => {
				e.preventDefault();
				const target = document.getElementById(`reader-entry-${index}`);
				if (target) {
					target.scrollIntoView({ behavior: "smooth", block: "start" });
				}
			});
			li.appendChild(link);
			readerView.tocList.appendChild(li);
		});

		entries.forEach((entry, index) => {
			const card = document.createElement("div");
			card.className = "card reader-entry";
			card.id = `reader-entry-${index}`;

			const imageList = getEntryImageUrls(entry);
			const hasImages = imageList.length > 0;
			const initialImage = hasImages ? imageList[0] : "";
			if (!hasImages) {
				card.classList.add("reader-entry--no-media");
			}
			const img = hasImages
				? `<button class="thumb__image" type="button" data-thumb-action="expand" aria-label="View full image"><img class="thumb" src="${esc(initialImage)}" alt="Entry image" loading="lazy" /></button>`
				: "";
			const navDisabled = imageList.length < 2;

			const tags = Array.isArray(entry.tags) ? entry.tags : [];
			const sources = Array.isArray(entry.sources) ? entry.sources : [];
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

			const descriptionHtml = renderMarkdown(entry.description || "");
			const indexLabelHtml =
				imageList.length > 0
					? `<div class="reader-entry__index">${1}/${imageList.length}</div>`
					: "";
			const mediaSection = hasImages
				? `
          <div class="reader-entry__media">
            ${img}
            <div class="reader-entry__nav">
              <button class="btn btn--outline btn--sm" data-thumb-action="prev" type="button" ${navDisabled ? "disabled" : ""} aria-label="Previous image">&lt; Prev</button>
              ${indexLabelHtml}
              <button class="btn btn--outline btn--sm" data-thumb-action="next" type="button" ${navDisabled ? "disabled" : ""} aria-label="Next image">Next &gt;</button>
            </div>
          </div>
        `
				: "";
			card.innerHTML = `
        <div class="reader-entry__header">
          <div class="card__title">${esc(entry.title || "Untitled")}</div>
        </div>
        ${mediaSection}
        <div class="card__body">
          <div class="card__text reader-entry__text markdown">${descriptionHtml}</div>
          ${tagList}
          ${sourceList}
          <div class="card__meta">by ${esc(getByline(entry))}</div>
        </div>
      `;

			const thumbImg = card.querySelector(".thumb");
			const expandBtn = card.querySelector('[data-thumb-action="expand"]');
			const prevBtn = card.querySelector('[data-thumb-action="prev"]');
			const nextBtn = card.querySelector('[data-thumb-action="next"]');
			const indexLabel = card.querySelector(".reader-entry__index");

			let imageIndex = 0;
			const updateThumb = () => {
				if (!thumbImg || !imageList.length) return;
				imageIndex = (imageIndex + imageList.length) % imageList.length;
				thumbImg.src = imageList[imageIndex];
				thumbImg.alt = `Entry image ${imageIndex + 1} of ${imageList.length}`;
				if (indexLabel) {
					indexLabel.textContent = `${imageIndex + 1}/${imageList.length}`;
				}
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

			readerView.entriesList.appendChild(card);
		});
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
				personal.btnRead.disabled = true;
				personal.btnDelete.disabled = true;
				personal.btnToggleVisibility.disabled = true;
			} else {
				pub.title.textContent = "Select a public compendium";
				pub.subtitle.textContent = "—";
				pub.btnRead.disabled = true;
				pub.btnDelete.disabled = true;
				pub.btnSave.disabled = true;
				pub.btnToggleVisibility.disabled = true;
				pub.editorsSection.classList.add("is-hidden");
			}
			return;
		}

		el.editorEmpty.classList.add("is-hidden");
		el.form.classList.remove("is-hidden");

		el.title.textContent = comp.name || "Untitled";
		el.subtitle.textContent = comp.topic ? `Subtitle: ${comp.topic}` : "—";
		el.ownerLine.textContent = `Owner: ${comp.ownerName || comp.ownerUid}`;
		el.btnRead.disabled = false;

		// Fill fields
		el.name.value = comp.name || "";
		el.topic.value = comp.topic || "";
		el.desc.value = comp.description || "";
		el.cover.value = comp.coverUrl || "";

		// Set tags using PillInput
		const tags = Array.isArray(comp.tags) ? comp.tags : [];
		if (isPersonal) {
			personalTagsInput.setItems(tags);
		} else {
			publicTagsInput.setItems(tags);
		}

		if (isPersonal) {
			const editable = canEditCompendium(user, comp);
			const owner = isOwner(user, comp);
			el.name.disabled = !editable;
			el.topic.disabled = !editable;
			el.desc.disabled = !editable;
			el.cover.disabled = !editable;
			el.tags.disabled = !editable;
			el.btnDelete.disabled = !owner;
			el.btnSave.disabled = !editable;
			el.btnToggleVisibility.disabled = !owner;
			el.btnToggleVisibility.textContent = "Make public";
		} else {
			const editable = canEditCompendium(user, comp);
			const owner = isOwner(user, comp);

			el.name.disabled = !editable;
			el.topic.disabled = !editable;
			el.desc.disabled = !editable;
			el.cover.disabled = !editable;
			el.tags.disabled = !editable;

			el.btnSave.disabled = !editable;
			el.btnDelete.disabled = !owner;
			el.btnToggleVisibility.disabled = !owner;
			el.btnToggleVisibility.textContent = "Make private";

			pub.editHint.textContent = editable
				? "You can edit topic/subtitle fields. Use the toggle to change visibility."
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

		const type = modal.typeToggle?.checked ? "public" : "personal";
		if (!name || !topic)
			return showModalError("Topic and subtitle are required.");
		if (type !== "personal" && type !== "public")
			return showModalError("Invalid type.");

		const coverSeed = stableSeed();

		try {
			await createCompendium({
				name,
				topic,
				description,
				tags: [],

				coverUrl: "",
				coverSeed: coverSeed || "",

				visibility: type,
				ownerUid: user.uid,
				ownerName: currentOwnerName || "",

				editorEmails: type === "public" ? [] : [],
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

	function updateNewCompTypeHint() {
		if (!modal.typeHint || !modal.typeToggle) return;
		modal.typeHint.textContent = modal.typeToggle.checked
			? "Public compendium (any logged-in user can add entries; editing controlled by owner/editors)."
			: "Personal compendium (only you can edit metadata/entries).";
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
		const coverUrl = el.cover.value.trim();
		const tags = isPersonal
			? personalTagsInput.getItems()
			: publicTagsInput.getItems();

		if (!name || !topic) {
			toast("Topic and subtitle required", "bad");
			return;
		}

		// Ensure a seed exists if coverUrl is blank (for older docs)
		const updates = ensureOwnerFields(comp, user, currentOwnerName, {
			name,
			topic,
			description,
			tags,
			coverUrl,
		});
		if (!comp.coverSeed) updates.coverSeed = stableSeed();

		try {
			await updateCompendium(compId, updates);
			// Optimistically update local state to avoid showing stale data
			if (selectedCompendium && selectedCompendium.id === compId) {
				selectedCompendium.doc = { ...selectedCompendium.doc, ...updates };
				paintEditor(scope);
			}
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

		const ok = await confirmDelete({
			title: "Delete this compendium?",
			copy: "This will remove the compendium.",
			detail: "Entries remain unless you delete them separately.",
		});
		if (!ok) return;

		try {
			await deleteCompendium(compId);
			toast("Deleted");

			selectCompendium(null, { navigate: false });
		} catch (e) {
			toast(e?.message || "Delete failed", "bad");
		}
	}

	async function toggleCompendiumVisibility(scope) {
		const { id: compId, doc: comp } = getSelectedForScope(scope);
		if (!compId || !comp) return;

		if (!isOwner(user, comp)) {
			toast("Owner only", "bad");
			return;
		}

		const nextVisibility = comp.visibility === "public" ? "personal" : "public";
		const confirmed = await confirmVisibilityChange(nextVisibility);
		if (!confirmed) return;

		const updates = ensureOwnerFields(comp, user, currentOwnerName, {
			visibility: nextVisibility,
		});
		if (nextVisibility === "personal") {
			updates.editorEmails = [];
		} else if (!Array.isArray(comp.editorEmails)) {
			updates.editorEmails = [];
		}

		try {
			await updateCompendium(compId, updates);
			// Don't update selectedScope here - let Firebase listener handle it
			// This prevents race conditions where we switch scope before the item
			// has moved between personalItems and publicItems arrays
			toast("Visibility updated");
		} catch (e) {
			toast(e?.message || "Visibility update failed", "bad");
		}
	}

	function confirmVisibilityChange(nextVisibility) {
		if (!visibilityConfirm.dlg?.showModal) {
			return Promise.resolve(true);
		}

		visibilityConfirm.title.textContent =
			nextVisibility === "public"
				? "Make compendium public?"
				: "Make compendium private?";
		visibilityConfirm.copy.textContent =
			nextVisibility === "public"
				? "Anyone can view it."
				: "Only you can access it.";
		visibilityConfirm.detail.textContent =
			nextVisibility === "public"
				? "You can add editors after switching."
				: "Current editors will be removed.";

		return new Promise((resolve) => {
			const handleClose = () => {
				visibilityConfirm.dlg.removeEventListener("close", handleClose);
				resolve(visibilityConfirm.dlg.returnValue === "confirm");
			};

			visibilityConfirm.dlg.addEventListener("close", handleClose);
			visibilityConfirm.dlg.showModal();
		});
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
			chip
				.querySelector(".chip__x")
				.addEventListener("click", () => dropEditor(email));
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
		if (email === normEmail(user.email || ""))
			return toast("You are the owner", "bad");

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
		},
		setOwnerName(nextName) {
			syncOwnerDisplayName(nextName);
		},
	};
}
