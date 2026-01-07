import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// --- Config ---
const firebaseConfig = {
  apiKey: "AIzaSyDf199rSY0dMSD-OZYFeiqVqz_pBOEvXR4",
  authDomain: "compendium-75ea8.firebaseapp.com",
  projectId: "compendium-75ea8",
  storageBucket: "compendium-75ea8.firebasestorage.app",
  messagingSenderId: "290402747744",
  appId: "1:290402747744:web:ffad2382b0739866ea4a05",
  measurementId: "G-3VNX1C0PM7"
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

function getTimestampMs(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return Number(value) || 0;
}

function sortByUpdatedAtDesc(items) {
  return items.sort((a, b) => getTimestampMs(b.updatedAt) - getTimestampMs(a.updatedAt));
}

// --- Auth wrappers (as requested) ---
export function watchAuth(cb) {
  return onAuthStateChanged(auth, (user) => cb(user || null));
}
export function createAccount(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}
export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
export function logout() {
  return signOut(auth);
}

// --- Profile ---
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, `users/${uid}/settings/usersettings`));
  return snap.exists() ? snap.data() : null;
}
export async function setUserProfile(uid, data) {
  await setDoc(doc(db, `users/${uid}/settings/usersettings`), {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// --- Settings ---
export async function getUserUiSettings(uid) {
  const snap = await getDoc(doc(db, `users/${uid}/settings/ui`));
  return snap.exists() ? snap.data() : null;
}
export async function setUserUiSettings(uid, data) {
  await setDoc(doc(db, `users/${uid}/settings/ui`), {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

// --- Compendiums ---
export function listenPersonalCompendiums(uid, cb, onErr) {
  const primaryQuery = query(
    collection(db, "compendiums"),
    where("ownerUid", "==", uid),
    where("visibility", "==", "personal"),
    orderBy("updatedAt", "desc")
  );
  const fallbackQuery = query(
    collection(db, "compendiums"),
    where("ownerUid", "==", uid),
    where("visibility", "==", "personal")
  );

  let primaryUnsubscribe = null;
  let fallbackUnsubscribe = null;

  const handleSnapshot = (snap, { sort = false } = {}) => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    cb(sort ? sortByUpdatedAtDesc(items) : items);
  };

  primaryUnsubscribe = onSnapshot(primaryQuery, (snap) => handleSnapshot(snap), (err) => {
    if (onErr) {
      onErr(err);
    }
    if (!fallbackUnsubscribe) {
      fallbackUnsubscribe = onSnapshot(fallbackQuery, (snap) => handleSnapshot(snap, { sort: true }), onErr);
    }
  });

  return () => {
    if (primaryUnsubscribe) {
      primaryUnsubscribe();
    }
    if (fallbackUnsubscribe) {
      fallbackUnsubscribe();
    }
  };
}

export function listenPublicCompendiums(cb, onErr) {
  const primaryQuery = query(
    collection(db, "compendiums"),
    where("visibility", "==", "public"),
    orderBy("updatedAt", "desc")
  );
  const fallbackQuery = query(
    collection(db, "compendiums"),
    where("visibility", "==", "public")
  );

  let primaryUnsubscribe = null;
  let fallbackUnsubscribe = null;

  const handleSnapshot = (snap, { sort = false } = {}) => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    cb(sort ? sortByUpdatedAtDesc(items) : items);
  };

  primaryUnsubscribe = onSnapshot(primaryQuery, (snap) => handleSnapshot(snap), (err) => {
    if (onErr) {
      onErr(err);
    }
    if (!fallbackUnsubscribe) {
      fallbackUnsubscribe = onSnapshot(fallbackQuery, (snap) => handleSnapshot(snap, { sort: true }), onErr);
    }
  });

  return () => {
    if (primaryUnsubscribe) {
      primaryUnsubscribe();
    }
    if (fallbackUnsubscribe) {
      fallbackUnsubscribe();
    }
  };
}

export async function createCompendium(payload) {
  return addDoc(collection(db, "compendiums"), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function updateCompendium(compendiumId, updates) {
  return updateDoc(doc(db, "compendiums", compendiumId), {
    ...updates,
    updatedAt: serverTimestamp()
  });
}

export async function deleteCompendium(compendiumId) {
  return deleteDoc(doc(db, "compendiums", compendiumId));
}

export async function addCompendiumEditor(compendiumId, email) {
  return updateDoc(doc(db, "compendiums", compendiumId), {
    editorEmails: arrayUnion(email),
    updatedAt: serverTimestamp()
  });
}

export async function removeCompendiumEditor(compendiumId, email) {
  return updateDoc(doc(db, "compendiums", compendiumId), {
    editorEmails: arrayRemove(email),
    updatedAt: serverTimestamp()
  });
}

// --- Entries ---
export function listenEntries(compendiumId, cb, onErr) {
  const entriesQuery = query(
    collection(db, "entries"),
    where("compendiumId", "==", compendiumId),
    orderBy("createdAt", "asc")
  );

  let unsubscribe = null;

  const handleSnapshot = (snap) => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    items.sort((a, b) => {
      const orderA = typeof a.order === "number" ? a.order : a.createdAt?.toMillis?.() ?? 0;
      const orderB = typeof b.order === "number" ? b.order : b.createdAt?.toMillis?.() ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      const createdA = a.createdAt?.toMillis?.() ?? 0;
      const createdB = b.createdAt?.toMillis?.() ?? 0;
      return createdA - createdB;
    });
    cb(items);
  };

  unsubscribe = onSnapshot(entriesQuery, handleSnapshot, (err) => {
    if (onErr) {
      onErr(err);
    }
  });

  return () => {
    if (unsubscribe) {
      unsubscribe();
    }
  };
}

export function listenEntriesByUserAccess(uid, cb, onErr) {
  const primaryQuery = query(
    collection(db, "entries"),
    where("createdByUid", "==", uid),
    orderBy("updatedAt", "desc")
  );
  const fallbackQuery = query(
    collection(db, "entries"),
    where("createdByUid", "==", uid)
  );

  let primaryUnsubscribe = null;
  let fallbackUnsubscribe = null;

  const handleSnapshot = (snap, { sort = false } = {}) => {
    const items = [];
    snap.forEach(d => items.push({ id: d.id, ...d.data() }));
    cb(sort ? sortByUpdatedAtDesc(items) : items);
  };

  primaryUnsubscribe = onSnapshot(primaryQuery, (snap) => handleSnapshot(snap), (err) => {
    const isIndexError = err?.code === "failed-precondition";
    if (!fallbackUnsubscribe) {
      fallbackUnsubscribe = onSnapshot(
        fallbackQuery,
        (snap) => handleSnapshot(snap, { sort: true }),
        (fallbackErr) => {
          if (onErr) {
            onErr(fallbackErr);
          }
        }
      );
    }
    if (!isIndexError && onErr) {
      onErr(err);
    }
  });

  return () => {
    if (primaryUnsubscribe) {
      primaryUnsubscribe();
    }
    if (fallbackUnsubscribe) {
      fallbackUnsubscribe();
    }
  };
}

export async function createEntry(payload) {
  return addDoc(collection(db, "entries"), {
    ...payload,
    order: typeof payload?.order === "number" ? payload.order : Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

export async function updateEntry(entryId, updates) {
  return updateDoc(doc(db, "entries", entryId), {
    ...updates,
    updatedAt: serverTimestamp()
  });
}

export async function deleteEntry(entryId) {
  return deleteDoc(doc(db, "entries", entryId));
}
