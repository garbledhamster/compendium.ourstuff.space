
import {
  state,
  saveStateLocal,
  nowISO,
  uid,
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
  PATHS,
  safeJSONParse
} from "./public.js";

import {
  saveCompendiumRemote,
  saveEntryRemote,
  deleteEntryRemote
} from "./private.js";

import {
  isDue,
  getDueEntries,
  upsertEntry
} from "./compendium.js";

function entryMatches(e, q) {
  const hay = [
    e.title, e.category, e.what, e.why, e.understanding,
    ...(e.keyPoints || []), ...(e.distinctions || []), ...(e.examples || []),
    ...(e.tags || []), ...(e.sources || []),
    ...((e.images || []).map(im => `${im.url || ""} ${im.caption || ""}`))
  ].join(" ").toLowerCase();
  return hay.includes(q);
}

function reviewEntry(user, compendiumId, entryId, grade) {
  const c = state.compendiums[compendiumId];
  const e = c?.entries?.[entryId];
  if (!e) return;

  const today = new Date();
  const interval = e.study?.intervalDays ?? 1;

  let nextInterval = interval;
  let lapses = e.study?.lapses ?? 0;

  if (grade === "good") nextInterval = clamp(Math.round(interval * 2), 1, 365);
  else { lapses += 1; nextInterval = 1; }

  const due = new Date(today);
  due.setDate(due.getDate() + nextInterval);

  e.study = {
    intervalDays: nextInterval,
    dueAt: due.toISOString(),
    lapses,
    lastReviewedAt: today.toISOString()
  };

  e.updatedAt = nowISO();
  c.updatedAt = nowISO();
  saveStateLocal();
  saveEntryRemote(user, compendiumId, e);
  saveCompendiumRemote(user, c);
}

function deleteEntry(user, compendiumId, entryId) {
  const c = state.compendiums[compendiumId];
  if (!c || !c.entries?.[entryId]) return;
  delete c.entries[entryId];
  c.updatedAt = nowISO();
  saveStateLocal();
  deleteEntryRemote(user, compendiumId, entryId);
  saveCompendiumRemote(user, c);
}

function sanitizeImageUrl(url) {
  const u = String(url || "").trim();
  if (!u) return "";
  if (u.startsWith("https://") || u.startsWith("http://")) return u;
  return "";
}

function carouselDotClass(active) {
  const base = "h-2.5 w-2.5 rounded-full border border-white/15";
  return active ? `${base} bg-cyan-400/80` : `${base} bg-white/10 hover:bg-white/20`;
}

function renderCarousel(images, carouselId, opts = {}) {
  const imgs = (images || []).filter(x => x?.url);
  const compact = !!opts.compact;
  if (!imgs.length) return `<div class="text-xs text-slate-400">No images added.</div>`;
  const json = JSON.stringify(imgs).replaceAll("<", "\\u003c");
  const h = compact ? "h-48" : "h-64";

  return `
    <div class="rounded-2xl border border-white/10 bg-slate-950/30 p-3"
      data-carousel-root="1" data-carousel-id="${escapeAttr(carouselId)}">
      <div class="relative overflow-hidden rounded-xl border border-white/10 bg-black/20">
        <button type="button" class="block w-full" data-action="open-image-viewer">
          <img data-carousel-img="1" data-carousel-index="0"
            class="w-full ${h} object-contain"
            src="${escapeAttr(imgs[0].url)}"
            alt="Entry image" loading="lazy" referrerpolicy="no-referrer" />
        </button>
      </div>

      <div class="mt-2 flex items-center justify-between gap-2">
        <div class="min-w-0 flex-1 text-xs text-slate-300 truncate" data-carousel-caption="1">
          ${escapeHTML(imgs[0].caption || "")}
        </div>

        <div class="flex gap-2">
          <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
            data-action="carousel-prev">
            <i data-lucide="chevron-left" class="h-4 w-4"></i>
          </button>
          <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
            data-action="carousel-next">
            <i data-lucide="chevron-right" class="h-4 w-4"></i>
          </button>
        </div>
      </div>

      <div class="mt-2 flex flex-wrap gap-2" data-carousel-dots="1">
        ${imgs.map((_, i) => `
          <button type="button" class="${carouselDotClass(i === 0)}"
            data-action="carousel-dot" data-index="${i}">
          </button>
        `).join("")}
      </div>

      <template data-carousel-data="1">${json}</template>
    </div>
  `;
}

function carouselRead(root) {
  const tpl = root?.querySelector?.('[data-carousel-data="1"]');
  return safeJSONParse(tpl?.textContent || "[]", []);
}

function carouselCurrentIndex(root) {
  const img = root?.querySelector?.('[data-carousel-img="1"]');
  const n = parseInt(img?.dataset?.carouselIndex || "0", 10);
  return Number.isFinite(n) ? n : 0;
}

function carouselSetIndex(root, idx) {
  if (!root) return;
  const imgs = carouselRead(root);
  if (!imgs.length) return;

  const n = imgs.length;
  idx = ((idx % n) + n) % n;

  const imgEl = root.querySelector('[data-carousel-img="1"]');
  const capEl = root.querySelector('[data-carousel-caption="1"]');
  const dots = root.querySelectorAll('[data-action="carousel-dot"]');

  if (imgEl) {
    imgEl.src = imgs[idx].url;
    imgEl.dataset.carouselIndex = String(idx);
  }
  if (capEl) capEl.textContent = imgs[idx].caption || "";
  dots.forEach((d, i) => { d.className = carouselDotClass(i === idx); });
  refreshIcons();
}

const viewer = { images: [], index: 0, title: "Images" };

function renderEntriesShell(c) {
  const rightHTML = `
    <a href="${escapeAttr(PATHS.compendium)}" class="hidden sm:inline-flex rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10">
      <span class="inline-flex items-center gap-2"><i data-lucide="layout-list" class="h-4 w-4"></i>Compendiums</span>
    </a>
    <button type="button" class="hidden sm:inline-flex rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10"
      data-action="toggle-theme">
      <span class="inline-flex items-center gap-2"><i data-lucide="moon" class="h-4 w-4"></i>Theme</span>
    </button>
    <a href="${escapeAttr(PATHS.settings)}" class="hidden sm:inline-flex rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10">
      <span class="inline-flex items-center gap-2"><i data-lucide="settings" class="h-4 w-4"></i>Settings</span>
    </a>
  `;

  const bodyHTML = `
    <div class="rounded-2xl border border-white/10 bg-white/5 shadow-glow backdrop-blur">
      <div class="border-b border-white/10 px-4 py-4 sm:px-6">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <div class="text-lg font-bold" id="pageTitle"></div>
            <div class="text-sm text-slate-300" id="pageSubtitle"></div>
          </div>

          <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select id="compendiumSelect"
              class="w-full sm:w-56 rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"></select>

            <div class="relative">
              <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <i data-lucide="search" class="h-4 w-4"></i>
              </span>
              <input id="globalSearch" type="search" placeholder="Search entries…"
                class="w-full sm:w-80 rounded-xl border border-white/10 bg-slate-950/40 pl-10 pr-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20" />
            </div>

            <button id="primaryActionBtn"
              class="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
              New entry
            </button>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
            data-action="set-view" data-view="entries">
            Entries
          </button>
          <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
            data-action="set-view" data-view="index">
            Index
          </button>
          <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
            data-action="set-view" data-view="study">
            Study
          </button>
        </div>
      </div>

      <div class="px-4 py-5 sm:px-6" id="mainContent"></div>
    </div>

    <dialog id="entryDialog" class="w-[min(920px,96vw)] rounded-2xl border border-white/10 bg-slate-950 text-slate-100 shadow-soft"></dialog>
    <dialog id="imageViewerDialog" class="w-[min(1100px,98vw)] rounded-2xl border border-white/10 bg-slate-950 text-slate-100 shadow-soft"></dialog>
  `;

  return shellHTML({
    title: "Compendium Builder",
    subtitle: "Capture, browse, and study your entries",
    rightHTML,
    bodyHTML,
    activeNav: "entries"
  });
}

function renderEntryDialogHTML() {
  return `
    <form method="dialog" class="p-0" id="entryForm">
      <div class="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <div class="text-base font-bold" id="entryDialogTitle">New Entry</div>
          <div class="text-xs text-slate-400" id="entryDialogSub">Write in your own words. Keep it reference-friendly.</div>
        </div>
        <div class="flex gap-2">
          <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10"
            data-action="close-entry-dialog">
            Cancel
          </button>
          <button type="submit" class="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
            Save
          </button>
        </div>
      </div>

      <div class="max-h-[70vh] overflow-auto px-5 py-5">
        <input type="hidden" id="entryId" />

        <div class="grid gap-4 sm:grid-cols-2">
          <label class="block">
            <div class="mb-1 text-xs font-semibold text-slate-300">Title</div>
            <input id="entryTitle" required
              class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20" />
          </label>

          <label class="block">
            <div class="mb-1 text-xs font-semibold text-slate-300">Category</div>
            <input id="entryCategory"
              class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20" />
          </label>
        </div>

        <div class="mt-4 grid gap-4">
          <label class="block">
            <div class="mb-1 text-xs font-semibold text-slate-300">What it is (1–2 lines)</div>
            <textarea id="entryWhat" rows="2"
              class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"></textarea>
          </label>

          <label class="block">
            <div class="mb-1 text-xs font-semibold text-slate-300">Key points (bullets)</div>
            <textarea id="entryKeyPoints" rows="4"
              class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"></textarea>
          </label>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block">
              <div class="mb-1 text-xs font-semibold text-slate-300">Distinctions / contrasts</div>
              <textarea id="entryDistinctions" rows="4"
                class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"></textarea>
            </label>

            <label class="block">
              <div class="mb-1 text-xs font-semibold text-slate-300">Examples / cases</div>
              <textarea id="entryExamples" rows="4"
                class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"></textarea>
            </label>
          </div>

          <label class="block">
            <div class="mb-1 text-xs font-semibold text-slate-300">Why it matters / use cases</div>
            <textarea id="entryWhy" rows="3"
              class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"></textarea>
          </label>

          <label class="block">
            <div class="mb-1 text-xs font-semibold text-slate-300">My understanding</div>
            <textarea id="entryUnderstanding" rows="3"
              class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"></textarea>
          </label>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block">
              <div class="mb-1 text-xs font-semibold text-slate-300">Sources (one per line)</div>
              <textarea id="entrySources" rows="3"
                class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"></textarea>
            </label>

            <label class="block">
              <div class="mb-1 text-xs font-semibold text-slate-300">Tags (comma-separated)</div>
              <input id="entryTags"
                class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20" />
            </label>
          </div>

          <div class="rounded-2xl border border-white/10 bg-slate-950/30 p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <div class="text-xs font-semibold text-slate-300">Images</div>
                <div class="mt-1 text-[11px] text-slate-400">Paste web image URLs (https). Stored as links.</div>
              </div>
              <button type="button"
                class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
                data-action="open-image-viewer">
                <span class="inline-flex items-center gap-2"><i data-lucide="maximize-2" class="h-4 w-4"></i>Viewer</span>
              </button>
            </div>

            <textarea id="entryImagesJSON" class="hidden"></textarea>

            <div class="mt-3 grid gap-2 sm:grid-cols-3">
              <input id="newImageUrl"
                class="sm:col-span-2 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                placeholder="Image URL (https://...)" />
              <button type="button"
                class="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
                data-action="add-image">
                Add
              </button>
              <input id="newImageCaption"
                class="sm:col-span-3 w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-sm outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
                placeholder="Caption (optional)" />
            </div>

            <div class="mt-3 grid gap-2" id="imagesList"></div>
            <div class="mt-3" id="imagesCarousel"></div>
          </div>
        </div>
      </div>
    </form>
  `;
}

function renderViewerDialogHTML() {
  return `
    <div class="p-0">
      <div class="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <div class="text-base font-bold" id="viewerTitle">Images</div>
          <div class="text-xs text-slate-400" id="viewerSub">—</div>
        </div>
        <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold hover:bg-white/10"
          data-action="close-image-viewer">
          Close
        </button>
      </div>

      <div class="px-5 py-5">
        <div class="relative overflow-hidden rounded-2xl border border-white/10 bg-black/20">
          <img id="viewerImg" class="w-full h-[70vh] object-contain" src="" alt="Image" loading="lazy" referrerpolicy="no-referrer" />
        </div>

        <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div class="min-w-0">
            <div class="text-sm text-slate-100" id="viewerCaption"></div>
            <div class="mt-1 text-[11px] text-slate-400 truncate" id="viewerUrl"></div>
          </div>

          <div class="flex gap-2">
            <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
              data-action="viewer-prev">
              <span class="inline-flex items-center gap-2"><i data-lucide="chevron-left" class="h-4 w-4"></i>Prev</span>
            </button>
            <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
              data-action="viewer-next">
              <span class="inline-flex items-center gap-2">Next<i data-lucide="chevron-right" class="h-4 w-4"></i></span>
            </button>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-2" id="viewerDots"></div>
      </div>
    </div>
  `;
}

export function mountEntriesPage(appEl, user) {
  const c = activeCompendium();

  appEl.innerHTML = renderEntriesShell(c);
  const entryDialog = document.getElementById("entryDialog");
  const viewerDialog = document.getElementById("imageViewerDialog");
  entryDialog.innerHTML = renderEntryDialogHTML();
  viewerDialog.innerHTML = renderViewerDialogHTML();

  let entryCarouselId = `entrydlg_${uid("car")}`;

  const getImagesDraft = () => safeJSONParse(document.getElementById("entryImagesJSON")?.value || "[]", []).filter(x => x && typeof x === "object");
  const setImagesDraft = (arr) => {
    const cleaned = (arr || [])
      .map(x => ({ url: sanitizeImageUrl(x?.url), caption: String(x?.caption || "").trim() }))
      .filter(x => x.url);
    document.getElementById("entryImagesJSON").value = JSON.stringify(cleaned);
    renderEntryImagesUI();
  };

  const renderEntryImagesUI = () => {
    const imgs = getImagesDraft();
    const list = document.getElementById("imagesList");
    const car = document.getElementById("imagesCarousel");

    if (list) {
      list.innerHTML = imgs.length ? imgs.map((im, i) => `
        <div class="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
          <button type="button" class="shrink-0" data-action="open-image-viewer" data-index="${i}">
            <img src="${escapeAttr(im.url)}" alt="thumb"
              class="h-14 w-20 rounded-xl border border-white/10 bg-black/20 object-cover"
              loading="lazy" referrerpolicy="no-referrer" />
          </button>

          <div class="min-w-0 flex-1 grid gap-2">
            <input class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
              value="${escapeAttr(im.url)}" data-action="image-edit" data-index="${i}" data-field="url" />
            <input class="w-full rounded-xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs outline-none focus:border-cyan-400/60 focus:ring-2 focus:ring-cyan-400/20"
              value="${escapeAttr(im.caption || "")}" data-action="image-edit" data-index="${i}" data-field="caption" />
          </div>

          <div class="flex flex-col gap-2">
            <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
              data-action="move-image-up" data-index="${i}" ${i === 0 ? "disabled" : ""}>
              <i data-lucide="chevron-up" class="h-4 w-4"></i>
            </button>
            <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
              data-action="move-image-down" data-index="${i}" ${i === imgs.length - 1 ? "disabled" : ""}>
              <i data-lucide="chevron-down" class="h-4 w-4"></i>
            </button>
            <button type="button" class="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-500/20"
              data-action="remove-image" data-index="${i}">
              <i data-lucide="trash-2" class="h-4 w-4"></i>
            </button>
          </div>
        </div>
      `).join("") : `
        <div class="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate-400">
          No images yet. Add one above.
        </div>
      `;
    }

    if (car) {
      car.innerHTML = imgs.length ? renderCarousel(imgs, entryCarouselId, { compact: true }) : "";
    }

    refreshIcons();
  };

  const openImageViewer = (images, startIndex = 0, title = "Images") => {
    viewer.images = (images || []).filter(x => x?.url);
    if (!viewer.images.length) { toast("No images to view.", "error"); return; }
    viewer.index = clamp(startIndex, 0, viewer.images.length - 1);
    viewer.title = title;
    renderImageViewer();
    try { viewerDialog.showModal(); } catch {}
    refreshIcons();
  };

  const closeImageViewer = () => { try { viewerDialog.close(); } catch {} };

  const renderImageViewer = () => {
    const imgs = viewer.images || [];
    const n = imgs.length;
    const i = clamp(viewer.index, 0, Math.max(0, n - 1));
    viewer.index = i;

    document.getElementById("viewerTitle").textContent = viewer.title || "Images";
    document.getElementById("viewerSub").textContent = n ? `${i + 1} / ${n}` : "—";

    const im = imgs[i] || {};
    document.getElementById("viewerImg").src = im.url || "";
    document.getElementById("viewerCaption").textContent = im.caption || "";
    document.getElementById("viewerUrl").textContent = im.url || "";

    const dots = document.getElementById("viewerDots");
    if (dots) {
      dots.innerHTML = n ? imgs.map((_, idx) => `
        <button type="button" class="${carouselDotClass(idx === i)}" data-action="viewer-dot" data-index="${idx}"></button>
      `).join("") : "";
    }

    refreshIcons();
  };

  const openEntryDialog = (entryId = "") => {
    const c = activeCompendium();
    if (!c) return;
    const e = entryId ? c.entries?.[entryId] : null;

    document.getElementById("entryId").value = e?.id || "";
    document.getElementById("entryTitle").value = e?.title || "";
    document.getElementById("entryCategory").value = e?.category || "";
    document.getElementById("entryWhat").value = e?.what || "";
    document.getElementById("entryKeyPoints").value = fromLines(e?.keyPoints || []);
    document.getElementById("entryDistinctions").value = fromLines(e?.distinctions || []);
    document.getElementById("entryExamples").value = fromLines(e?.examples || []);
    document.getElementById("entryWhy").value = e?.why || "";
    document.getElementById("entryUnderstanding").value = e?.understanding || "";
    document.getElementById("entrySources").value = fromLines(e?.sources || []);
    document.getElementById("entryTags").value = (e?.tags || []).join(", ");

    document.getElementById("entryDialogTitle").textContent = e ? "Edit Entry" : "New Entry";

    document.getElementById("newImageUrl").value = "";
    document.getElementById("newImageCaption").value = "";

    entryCarouselId = `entrydlg_${(e?.id || "new")}_${uid("car")}`;
    setImagesDraft(e?.images || []);

    try { entryDialog.showModal(); } catch {}
    refreshIcons();
  };

  const closeEntryDialog = () => { try { entryDialog.close(); } catch {} };

  const readEntryForm = () => ({
    id: document.getElementById("entryId").value.trim() || null,
    title: document.getElementById("entryTitle").value.trim(),
    category: document.getElementById("entryCategory").value.trim(),
    what: document.getElementById("entryWhat").value.trim(),
    keyPoints: toLines(document.getElementById("entryKeyPoints").value),
    distinctions: toLines(document.getElementById("entryDistinctions").value),
    examples: toLines(document.getElementById("entryExamples").value),
    why: document.getElementById("entryWhy").value.trim(),
    understanding: document.getElementById("entryUnderstanding").value.trim(),
    sources: toLines(document.getElementById("entrySources").value),
    tags: document.getElementById("entryTags").value.split(",").map(x => x.trim()).filter(Boolean),
    images: getImagesDraft()
  });

  const renderTop = () => {
    const c = activeCompendium();

    const pageTitle = document.getElementById("pageTitle");
    const pageSubtitle = document.getElementById("pageSubtitle");
    const primaryBtn = document.getElementById("primaryActionBtn");

    if (!c) {
      pageTitle.textContent = "No compendium selected";
      pageSubtitle.textContent = "Create or select one in Compendiums.";
      primaryBtn.textContent = "Open Compendiums";
      primaryBtn.dataset.primary = "open-compendium";
      return;
    }

    const counts = Object.keys(c.entries || {}).length;
    const due = getDueEntries(c).length;
    const view = state.view || "entries";

    if (view === "entries") {
      pageTitle.textContent = c.name;
      pageSubtitle.textContent = `${counts} entries • ${due} due`;
      primaryBtn.textContent = "New entry";
      primaryBtn.dataset.primary = "new-entry";
      return;
    }

    if (view === "index") {
      pageTitle.textContent = `Index: ${c.name}`;
      pageSubtitle.textContent = "Browse categories, tags, and sources.";
      primaryBtn.textContent = "New entry";
      primaryBtn.dataset.primary = "new-entry";
      return;
    }

    if (view === "study") {
      pageTitle.textContent = `Study: ${c.name}`;
      pageSubtitle.textContent = c.settings.studyMode === "random" ? "Random active recall" : `${due} due (spaced practice)`;
      primaryBtn.textContent = "Start";
      primaryBtn.dataset.primary = "study-start";
      return;
    }
  };

  const renderEntries = (c) => {
    const q = String(document.getElementById("globalSearch").value || "").trim().toLowerCase();
    const entries = Object.values(c.entries || {}).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const filtered = q ? entries.filter(e => entryMatches(e, q)) : entries;

    const statCard = (label, value, icon) => `
      <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div class="flex items-center justify-between">
          <div class="text-xs font-semibold text-slate-300">${escapeHTML(label)}</div>
          <i data-lucide="${escapeAttr(icon)}" class="h-4 w-4 text-slate-400"></i>
        </div>
        <div class="mt-2 text-2xl font-extrabold">${value}</div>
      </div>
    `;

    const card = (e) => {
      const dueLabel = isDue(e) ? "Due" : "Not due";
      const dueCls = isDue(e) ? "border-amber-400/25 bg-amber-500/10 text-amber-100" : "border-white/10 bg-slate-950/30 text-slate-300";
      const tags = (e.tags || []).slice(0, 6);
      const imgCount = (e.images || []).filter(x => x?.url).length;

      return `
        <div class="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <div class="truncate text-sm font-semibold">${escapeHTML(e.title || "Untitled")}</div>
                <span class="rounded-full border ${dueCls} px-2 py-0.5 text-[11px]">${escapeHTML(dueLabel)}</span>
                ${e.category ? `<span class="rounded-full border border-white/10 bg-slate-950/30 px-2 py-0.5 text-[11px] text-slate-300">${escapeHTML(e.category)}</span>` : ""}
                ${imgCount ? `<span class="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-950/30 px-2 py-0.5 text-[11px] text-slate-300"><i data-lucide="image" class="h-3.5 w-3.5"></i>${imgCount}</span>` : ""}
              </div>
              <div class="mt-2 text-xs text-slate-400 line-clamp-2">
                ${escapeHTML(e.what || e.understanding || "") || "<span class='text-slate-500'>No summary yet.</span>"}
              </div>
              <div class="mt-2 flex flex-wrap gap-2">
                ${tags.map(t => `<span class="rounded-full border border-white/10 bg-slate-950/30 px-2 py-0.5 text-[11px] text-slate-300">#${escapeHTML(t)}</span>`).join("")}
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
                data-action="open-entry-dialog" data-id="${escapeAttr(e.id)}">
                <span class="inline-flex items-center gap-2"><i data-lucide="pencil" class="h-4 w-4"></i>Edit</span>
              </button>
              <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
                data-action="quick-review" data-grade="good" data-id="${escapeAttr(e.id)}">
                <span class="inline-flex items-center gap-2"><i data-lucide="check" class="h-4 w-4"></i>Remembered</span>
              </button>
              <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold hover:bg-white/10"
                data-action="quick-review" data-grade="again" data-id="${escapeAttr(e.id)}">
                <span class="inline-flex items-center gap-2"><i data-lucide="rotate-ccw" class="h-4 w-4"></i>Need work</span>
              </button>
              <button type="button" class="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-100 hover:bg-rose-500/20"
                data-action="delete-entry" data-id="${escapeAttr(e.id)}">
                <span class="inline-flex items-center gap-2"><i data-lucide="trash-2" class="h-4 w-4"></i>Delete</span>
              </button>
            </div>
          </div>
        </div>
      `;
    };

    const main = `
      <div class="grid gap-3 sm:grid-cols-3">
        ${statCard("Entries", entries.length, "list")}
        ${statCard("Due", getDueEntries(c).length, "calendar-clock")}
        ${statCard("Categories", uniqueNonEmpty(entries.map(e => e.category)).length, "shapes")}
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <button type="button" class="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
          data-action="open-entry-dialog" data-id="">
          <span class="inline-flex items-center gap-2"><i data-lucide="plus" class="h-4 w-4"></i>New entry</span>
        </button>
        <a href="${escapeAttr(PATHS.compendium)}" class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10">
          <span class="inline-flex items-center gap-2"><i data-lucide="layout-list" class="h-4 w-4"></i>Compendiums</span>
        </a>
      </div>

      <div class="mt-4 grid gap-3">
        ${filtered.length ? filtered.map(card).join("") : `
          <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div class="text-sm font-semibold">${entries.length ? "No matches" : "No entries yet"}</div>
            <div class="mt-1 text-xs text-slate-400">${entries.length ? "Try a different search." : "Create your first entry."}</div>
          </div>
        `}
      </div>
    `;

    return main;
  };

  const renderIndex = (c) => {
    const entries = Object.values(c.entries || {});
    const categories = uniqueNonEmpty(entries.map(e => e.category)).sort((a, b) => a.localeCompare(b));
    const tags = uniqueNonEmpty(entries.flatMap(e => e.tags || [])).sort((a, b) => a.localeCompare(b));
    const sources = uniqueNonEmpty(entries.flatMap(e => e.sources || [])).slice(0, 50);

    const chip = (label, kind) => `
      <button type="button" class="rounded-full border border-white/10 bg-slate-950/30 px-3 py-1 text-xs text-slate-200 hover:bg-white/10"
        data-action="filter-by" data-kind="${escapeAttr(kind)}" data-value="${escapeAttr(label)}">
        ${escapeHTML(label)}
      </button>
    `;

    const empty = (msg) => `<div class="text-xs text-slate-400">${escapeHTML(msg)}</div>`;

    return `
      <div class="grid gap-4 lg:grid-cols-3">
        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">Categories</div>
            <div class="text-xs text-slate-400">${categories.length}</div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            ${categories.length ? categories.map(cat => chip(cat, "category")).join("") : empty("No categories yet.")}
          </div>
        </div>

        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">Tags</div>
            <div class="text-xs text-slate-400">${tags.length}</div>
          </div>
          <div class="mt-3 flex flex-wrap gap-2">
            ${tags.length ? tags.map(t => chip("#" + t, "tag")).join("") : empty("No tags yet.")}
          </div>
        </div>

        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">Sources</div>
            <div class="text-xs text-slate-400">${sources.length}</div>
          </div>
          <div class="mt-3 max-h-[45vh] overflow-auto pr-1 space-y-2">
            ${sources.length ? sources.map(s => `
              <div class="rounded-xl border border-white/10 bg-slate-950/30 p-3 text-xs text-slate-300">
                ${escapeHTML(s)}
              </div>
            `).join("") : empty("No sources yet.")}
          </div>
        </div>
      </div>
    `;
  };

  const renderStudy = (c) => {
    const entries = Object.values(c.entries || {});
    if (!entries.length) {
      return `
        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold">No entries to study yet</div>
          <div class="mt-1 text-xs text-slate-400">Create at least one entry.</div>
        </div>
      `;
    }

    const mode = c.settings.studyMode || "due";
    const due = getDueEntries(c);
    const candidate = mode === "random"
      ? entries[Math.floor(Math.random() * entries.length)]
      : (due[0] || null);

    if (!candidate) {
      return `
        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold">Nothing due right now</div>
          <div class="mt-1 text-xs text-slate-400">Switch to Random mode, or come back later.</div>
          <div class="mt-3 flex gap-2">
            <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
              data-action="set-study-mode" data-mode="random">
              Random mode
            </button>
          </div>
        </div>
      `;
    }

    const block = (label, html) => html ? `
      <div class="mt-3">
        <div class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">${escapeHTML(label)}</div>
        <div class="mt-1 text-sm text-slate-200">${html}</div>
      </div>
    ` : "";

    const bullets = (arr) => (arr?.length)
      ? `<ul class="list-disc pl-5 space-y-1">${arr.map(x => `<li>${escapeHTML(x)}</li>`).join("")}</ul>`
      : "";

    const imgs = (candidate.images || []).filter(x => x?.url);
    const carId = `study_${candidate.id}`;

    const revealHTML = `
      ${block("What it is", escapeHTML(candidate.what))}
      ${block("Key points", bullets(candidate.keyPoints))}
      ${block("Distinctions", bullets(candidate.distinctions))}
      ${block("Examples", bullets(candidate.examples))}
      ${block("Why it matters", escapeHTML(candidate.why))}
      ${block("My understanding", escapeHTML(candidate.understanding))}
      ${imgs.length ? block("Images", renderCarousel(imgs, carId, { compact: false })) : ""}
      ${block("Sources", bullets(candidate.sources))}
    `;

    return `
      <div class="grid gap-4 lg:grid-cols-3">
        <div class="lg:col-span-2 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div class="text-xs font-semibold text-slate-300">Active recall card</div>
              <div class="mt-1 text-lg font-extrabold">${escapeHTML(candidate.title || "Untitled")}</div>
              <div class="mt-1 text-xs text-slate-400">
                ${candidate.category ? `Category: ${escapeHTML(candidate.category)} • ` : ""}Interval: ${candidate.study?.intervalDays ?? 1} day(s)
              </div>
            </div>

            <div class="flex gap-2">
              <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
                data-action="toggle-reveal">
                <span class="inline-flex items-center gap-2"><i data-lucide="eye" class="h-4 w-4"></i>Reveal</span>
              </button>
              <button type="button" class="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10"
                data-action="open-entry-dialog" data-id="${escapeAttr(candidate.id)}">
                <span class="inline-flex items-center gap-2"><i data-lucide="pencil" class="h-4 w-4"></i>Edit</span>
              </button>
            </div>
          </div>

          <div class="mt-4 rounded-2xl border border-white/10 bg-slate-950/30 p-4">
            <div class="text-xs font-semibold text-slate-300">Prompt</div>
            <div class="mt-2 text-sm text-slate-200">Explain this from memory. Then reveal and compare.</div>
            <div class="mt-4 hidden" id="revealBox">${revealHTML}</div>
          </div>

          <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="text-xs text-slate-400">Need work resets interval to 1 day.</div>
            <div class="flex gap-2">
              <button type="button" class="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 hover:bg-rose-500/20"
                data-action="study-grade" data-grade="again" data-id="${escapeAttr(candidate.id)}">
                Need work
              </button>
              <button type="button" class="rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
                data-action="study-grade" data-grade="good" data-id="${escapeAttr(candidate.id)}">
                Remembered
              </button>
            </div>
          </div>
        </div>

        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="flex items-center justify-between">
            <div class="text-sm font-semibold">Study settings</div>
            <i data-lucide="sliders" class="h-4 w-4 text-slate-400"></i>
          </div>

          <div class="mt-3 rounded-2xl border border-white/10 bg-slate-950/30 p-4">
            <div class="text-xs font-semibold text-slate-300">Mode</div>
            <div class="mt-2 grid grid-cols-2 gap-2">
              <button type="button" class="rounded-xl border ${mode === "due" ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/10 bg-white/5"} px-3 py-2 text-xs font-semibold hover:bg-white/10"
                data-action="set-study-mode" data-mode="due">Due</button>
              <button type="button" class="rounded-xl border ${mode === "random" ? "border-cyan-400/40 bg-cyan-500/10" : "border-white/10 bg-white/5"} px-3 py-2 text-xs font-semibold hover:bg-white/10"
                data-action="set-study-mode" data-mode="random">Random</button>
            </div>
          </div>

          <div class="mt-4 rounded-2xl border border-white/10 bg-slate-950/30 p-4">
            <div class="text-xs font-semibold text-slate-300">Due queue</div>
            <div class="mt-2 text-xs text-slate-400">${getDueEntries(c).length} due</div>
          </div>
        </div>
      </div>
    `;
  };

  const renderMain = () => {
    const c = activeCompendium();
    const main = document.getElementById("mainContent");
    if (!main) return;

    if (!c) {
      main.innerHTML = `
        <div class="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div class="text-sm font-semibold">No compendium selected</div>
          <div class="mt-1 text-xs text-slate-400">Go to Compendiums and create/select one.</div>
          <a href="${escapeAttr(PATHS.compendium)}" class="mt-3 inline-flex rounded-xl bg-cyan-500/90 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
            <span class="inline-flex items-center gap-2"><i data-lucide="layout-list" class="h-4 w-4"></i>Open Compendiums</span>
          </a>
        </div>
      `;
      refreshIcons();
      return;
    }

    const view = state.view || "entries";
    if (view === "index") main.innerHTML = renderIndex(c);
    else if (view === "study") main.innerHTML = renderStudy(c);
    else main.innerHTML = renderEntries(c);

    refreshIcons();
  };

  const populateCompendiumSelect = () => {
    const sel = document.getElementById("compendiumSelect");
    if (!sel) return;
    const comps = Object.values(state.compendiums || {}).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    sel.innerHTML = comps.length
      ? comps.map(c => `<option value="${escapeAttr(c.id)}" ${c.id === state.activeCompendiumId ? "selected" : ""}>${escapeHTML(c.name)}</option>`).join("")
      : `<option value="">No compendiums</option>`;
  };

  const renderAll = () => {
    populateCompendiumSelect();
    renderTop();
    renderMain();
    refreshIcons();
  };

  renderAll();

  document.getElementById("globalSearch")?.addEventListener("input", () => {
    if (state.view !== "entries") state.view = "entries";
    saveStateLocal();
    renderAll();
  });

  document.getElementById("compendiumSelect")?.addEventListener("change", (ev) => {
    setActiveCompendium(ev.target.value);
    renderAll();
  });

  document.getElementById("primaryActionBtn")?.addEventListener("click", () => {
    const c = activeCompendium();
    const primary = document.getElementById("primaryActionBtn").dataset.primary;
    if (primary === "open-compendium") { window.location.href = PATHS.compendium; return; }
    if (!c) return;
    if (primary === "new-entry") { openEntryDialog(""); return; }
    if (primary === "study-start") { state.view = "study"; saveStateLocal(); renderAll(); return; }
  });

  appEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-action]");
    if (!btn) return;

    const action = btn.dataset.action;

    if (action.startsWith("carousel-") || action.startsWith("viewer-") || action === "open-image-viewer") {
      ev.preventDefault();
      ev.stopPropagation();
    }

    const c = activeCompendium();

    if (action === "toggle-theme") {
      toggleTheme();
      return;
    }

    if (action === "set-view") {
      state.view = btn.dataset.view || "entries";
      saveStateLocal();
      renderAll();
      return;
    }

    if (action === "open-entry-dialog") {
      openEntryDialog(btn.dataset.id || "");
      return;
    }

    if (action === "close-entry-dialog") {
      closeEntryDialog();
      return;
    }

    if (!c) return;

    if (action === "delete-entry") {
      const id = btn.dataset.id;
      const title = c.entries[id]?.title || "this entry";
      if (confirm(`Delete “${title}”?`)) {
        deleteEntry(user, c.id, id);
        renderAll();
      }
      return;
    }

    if (action === "quick-review") {
      const id = btn.dataset.id;
      const grade = btn.dataset.grade === "good" ? "good" : "again";
      reviewEntry(user, c.id, id, grade);
      toast(grade === "good" ? "Scheduled later ✅" : "Reset for tomorrow ↩️", "ok");
      renderAll();
      return;
    }

    if (action === "toggle-reveal") {
      const reveal = document.getElementById("revealBox");
      if (reveal) reveal.classList.toggle("hidden");
      return;
    }

    if (action === "set-study-mode") {
      c.settings.studyMode = btn.dataset.mode;
      c.updatedAt = nowISO();
      saveStateLocal();
      saveCompendiumRemote(user, c);
      renderAll();
      return;
    }

    if (action === "study-grade") {
      const id = btn.dataset.id;
      const grade = btn.dataset.grade === "good" ? "good" : "again";
      reviewEntry(user, c.id, id, grade);
      toast(grade === "good" ? "Nice. Pushed out. ✅" : "Good catch. Back tomorrow. ↩️", "ok");
      renderAll();
      return;
    }

    if (action === "filter-by") {
      const kind = btn.dataset.kind;
      const value = btn.dataset.value || "";
      const search = document.getElementById("globalSearch");
      if (kind === "tag") search.value = value.replace(/^#/, "");
      if (kind === "category") search.value = value;
      state.view = "entries";
      saveStateLocal();
      renderAll();
      return;
    }

    if (action === "add-image") {
      const url = sanitizeImageUrl(document.getElementById("newImageUrl").value);
      const caption = String(document.getElementById("newImageCaption").value || "").trim();
      if (!url) { toast("Image URL must start with https:// (or http://).", "error"); return; }
      const imgs = getImagesDraft();
      const exists = imgs.some(x => (x.url || "").trim().toLowerCase() === url.trim().toLowerCase());
      if (exists) { toast("That image URL is already added.", "error"); return; }
      imgs.push({ url, caption });
      document.getElementById("newImageUrl").value = "";
      document.getElementById("newImageCaption").value = "";
      setImagesDraft(imgs);
      toast("Added image.", "ok");
      return;
    }

    if (action === "remove-image") {
      const idx = parseInt(btn.dataset.index || "-1", 10);
      const imgs = getImagesDraft();
      if (!Number.isFinite(idx) || idx < 0 || idx >= imgs.length) return;
      imgs.splice(idx, 1);
      setImagesDraft(imgs);
      toast("Removed image.", "ok");
      return;
    }

    if (action === "move-image-up" || action === "move-image-down") {
      const idx = parseInt(btn.dataset.index || "-1", 10);
      const imgs = getImagesDraft();
      if (!Number.isFinite(idx) || idx < 0 || idx >= imgs.length) return;
      const j = action === "move-image-up" ? idx - 1 : idx + 1;
      if (j < 0 || j >= imgs.length) return;
      const tmp = imgs[idx];
      imgs[idx] = imgs[j];
      imgs[j] = tmp;
      setImagesDraft(imgs);
      return;
    }

    if (action === "open-image-viewer") {
      const root = btn.closest('[data-carousel-root="1"]');
      if (root) {
        const imgs = carouselRead(root);
        const idx = carouselCurrentIndex(root);
        openImageViewer(imgs, idx, "Images");
        return;
      }
      const imgs = getImagesDraft();
      const idx = parseInt(btn.dataset.index || "0", 10) || 0;
      openImageViewer(imgs, idx, "Images");
      return;
    }

    if (action === "carousel-prev" || action === "carousel-next") {
      const root = btn.closest('[data-carousel-root="1"]');
      if (!root) return;
      const cur = carouselCurrentIndex(root);
      const delta = action === "carousel-prev" ? -1 : 1;
      carouselSetIndex(root, cur + delta);
      return;
    }

    if (action === "carousel-dot") {
      const root = btn.closest('[data-carousel-root="1"]');
      if (!root) return;
      const idx = parseInt(btn.dataset.index || "0", 10) || 0;
      carouselSetIndex(root, idx);
      return;
    }

    if (action === "close-image-viewer") { closeImageViewer(); return; }
    if (action === "viewer-prev") { viewer.index = viewer.index - 1; if (viewer.index < 0) viewer.index = (viewer.images.length || 1) - 1; renderImageViewer(); return; }
    if (action === "viewer-next") { viewer.index = viewer.index + 1; if (viewer.index >= (viewer.images.length || 0)) viewer.index = 0; renderImageViewer(); return; }
    if (action === "viewer-dot") { viewer.index = parseInt(btn.dataset.index || "0", 10) || 0; renderImageViewer(); return; }
  });

  appEl.addEventListener("input", (ev) => {
    const imgEdit = ev.target.closest("[data-action='image-edit']");
    if (!imgEdit) return;
    const idx = parseInt(imgEdit.dataset.index || "-1", 10);
    const field = imgEdit.dataset.field;
    const imgs = getImagesDraft();
    if (!Number.isFinite(idx) || idx < 0 || idx >= imgs.length) return;

    if (field === "url") {
      imgs[idx].url = sanitizeImageUrl(imgEdit.value);
      setImagesDraft(imgs);
      return;
    }

    if (field === "caption") {
      imgs[idx].caption = String(imgEdit.value || "").trim();
      document.getElementById("entryImagesJSON").value = JSON.stringify(imgs.filter(x => x?.url));
      renderEntryImagesUI();
      return;
    }
  });

  document.getElementById("entryForm")?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const c = activeCompendium();
    if (!c) return;

    const data = readEntryForm();
    if (!data.title.trim()) { toast("Title is required.", "error"); return; }
    upsertEntry(user, c.id, data);
    closeEntryDialog();
    toast("Saved entry.", "ok");
    renderAll();
  });
}
