
import {
  doc,
  setDoc,
  getDoc,
  collection,
  getDocs,
  updateDoc,
  deleteDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

import { db } from "./authentication.js";
import {
  state,
  nowISO,
  normalizeTimestamp,
  generateSalt,
  saveStateLocal,
  toast
} from "./public.js";

const getUserProvider = (user) => user?.providerData?.[0]?.providerId || user?.providerId || "unknown";
const getUserDisplayName = (user) => user?.displayName || user?.providerData?.[0]?.displayName || "";

export async function saveCompendiumRemote(user, compendium, { isNew = false } = {}) {
  if (!user || !compendium?.id) return;
  const { entries, createdAt, updatedAt, ...payload } = compendium;
  const ref = doc(db, "users", user.uid, "compendiums", compendium.id);
  try {
    if (isNew) {
      await setDoc(ref, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } else {
      await updateDoc(ref, { ...payload, updatedAt: serverTimestamp() });
    }
  } catch {
    try {
      await setDoc(ref, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    } catch {
      toast("Cloud sync failed for compendium updates.", "error");
    }
  }
}

export async function saveEntryRemote(user, compendiumId, entry, { isNew = false } = {}) {
  if (!user || !compendiumId || !entry?.id) return;
  const { createdAt, updatedAt, ...payload } = entry;
  const ref = doc(db, "users", user.uid, "compendiums", compendiumId, "entries", entry.id);
  try {
    if (isNew) {
      await setDoc(ref, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    } else {
      await updateDoc(ref, { ...payload, updatedAt: serverTimestamp() });
    }
  } catch {
    try {
      await setDoc(ref, { ...payload, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    } catch {
      toast("Cloud sync failed for entry updates.", "error");
    }
  }
}

export async function deleteEntryRemote(user, compendiumId, entryId) {
  if (!user || !compendiumId || !entryId) return;
  try {
    await deleteDoc(doc(db, "users", user.uid, "compendiums", compendiumId, "entries", entryId));
  } catch {
    toast("Cloud delete failed for entry.", "error");
  }
}

export async function deleteCompendiumRemote(user, compendiumId) {
  if (!user || !compendiumId) return;
  try {
    const entriesSnap = await getDocs(collection(db, "users", user.uid, "compendiums", compendiumId, "entries"));
    for (const entrySnap of entriesSnap.docs) await deleteDoc(entrySnap.ref);
    await deleteDoc(doc(db, "users", user.uid, "compendiums", compendiumId));
  } catch {
    toast("Cloud delete failed for compendium.", "error");
  }
}

export async function fetchUserCompendiums(user) {
  const compendiums = {};
  const compendiumSnap = await getDocs(collection(db, "users", user.uid, "compendiums"));
  for (const docSnap of compendiumSnap.docs) {
    const data = docSnap.data() || {};
    const entriesSnap = await getDocs(collection(db, "users", user.uid, "compendiums", docSnap.id, "entries"));
    const entries = {};
    for (const entrySnap of entriesSnap.docs) {
      const entryData = entrySnap.data() || {};
      const study = entryData.study
        ? {
            ...entryData.study,
            dueAt: normalizeTimestamp(entryData.study.dueAt),
            lastReviewedAt: normalizeTimestamp(entryData.study.lastReviewedAt)
          }
        : entryData.study;

      entries[entrySnap.id] = {
        ...entryData,
        id: entrySnap.id,
        createdAt: normalizeTimestamp(entryData.createdAt) || nowISO(),
        updatedAt: normalizeTimestamp(entryData.updatedAt) || nowISO(),
        study
      };
    }

    compendiums[docSnap.id] = {
      id: docSnap.id,
      name: data.name || "Untitled Compendium",
      topic: data.topic || "",
      scope: data.scope || "topic",
      audience: data.audience || "personal",
      template: data.template || "parker",
      createdAt: normalizeTimestamp(data.createdAt) || nowISO(),
      updatedAt: normalizeTimestamp(data.updatedAt) || nowISO(),
      starterTitles: data.starterTitles || [],
      categories: data.categories || [],
      entries,
      settings: data.settings || { studyMode: "due" }
    };
  }
  return compendiums;
}

export async function seedRemoteFromLocal(user, compendiums) {
  if (!user) return;
  const compendiumList = Object.values(compendiums || {});
  for (const compendium of compendiumList) {
    await saveCompendiumRemote(user, compendium, { isNew: true });
    const entryList = Object.values(compendium.entries || {});
    for (const entry of entryList) await saveEntryRemote(user, compendium.id, entry, { isNew: true });
  }
}

export async function syncRemoteFromLocal(user, compendiums) {
  if (!user) return;
  const compendiumList = Object.values(compendiums || {});
  for (const compendium of compendiumList) {
    await saveCompendiumRemote(user, compendium);
    const entryList = Object.values(compendium.entries || {});
    for (const entry of entryList) await saveEntryRemote(user, compendium.id, entry);
  }
}

export async function loadUserData(user) {
  if (!user) return;
  try {
    const userRef = doc(db, "users", user.uid);
    const snapshot = await getDoc(userRef);

    if (!snapshot.exists()) {
      const salt = generateSalt();
      await setDoc(
        userRef,
        {
          email: user.email || "",
          displayName: getUserDisplayName(user),
          provider: getUserProvider(user),
          salt,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } else {
      await updateDoc(userRef, {
        email: user.email || "",
        displayName: getUserDisplayName(user),
        provider: getUserProvider(user),
        updatedAt: serverTimestamp()
      });
    }

    const remoteCompendiums = await fetchUserCompendiums(user);

    if (Object.keys(remoteCompendiums).length) {
      state.compendiums = remoteCompendiums;
    } else if (Object.keys(state.compendiums || {}).length) {
      await seedRemoteFromLocal(user, state.compendiums);
    }

    if (state.activeCompendiumId && !state.compendiums[state.activeCompendiumId]) state.activeCompendiumId = null;
    if (!state.activeCompendiumId) state.activeCompendiumId = Object.keys(state.compendiums || {})[0] || null;

    saveStateLocal();
  } catch {
    toast("Unable to load cloud data. Using local data.", "error");
  }
}
