
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDf199rSY0dMSD-OZYFeiqVqz_pBOEvXR4",
  authDomain: "compendium-75ea8.firebaseapp.com",
  projectId: "compendium-75ea8",
  storageBucket: "compendium-75ea8.firebasestorage.app",
  messagingSenderId: "290402747744",
  appId: "1:290402747744:web:ffad2382b0739866ea4a05",
  measurementId: "G-3VNX1C0PM7"
};

const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);

let currentUser = null;

export function getCurrentUser() {
  return currentUser;
}

export function watchAuth(cb) {
  return onAuthStateChanged(auth, (user) => {
    currentUser = user || null;
    cb(user || null);
  });
}

export async function createAccount(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function logout() {
  return signOut(auth);
}
