import { redirectIfAuthed, createAccount, signIn } from "./authentication.js";

const $ = (s) => document.querySelector(s);

redirectIfAuthed({ redirectTo: "./index.html" });

const errBox = $("#errBox");
const submitBtn = $("#submitBtn");
const modeSignIn = $("#modeSignIn");
const modeCreate = $("#modeCreate");
const showPw = $("#showPw");

let mode = "signin";

function setMode(next) {
  mode = next;
  modeSignIn.classList.toggle("is-active", mode === "signin");
  modeCreate.classList.toggle("is-active", mode === "create");
  submitBtn.textContent = mode === "signin" ? "Sign In" : "Create Account";
  clearError();
}

function setBusy(busy) {
  submitBtn.disabled = busy;
  submitBtn.textContent = busy
    ? (mode === "signin" ? "Signing in…" : "Creating…")
    : (mode === "signin" ? "Sign In" : "Create Account");
}

function showError(msg) {
  errBox.textContent = msg;
  errBox.classList.remove("is-hidden");
}

function clearError() {
  errBox.textContent = "";
  errBox.classList.add("is-hidden");
}

modeSignIn.addEventListener("click", () => setMode("signin"));
modeCreate.addEventListener("click", () => setMode("create"));

showPw.addEventListener("change", () => {
  $("#password").type = showPw.checked ? "text" : "password";
});

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const email = $("#email").value.trim();
  const password = $("#password").value;

  if (!email || !password) return showError("Email and password are required.");

  setBusy(true);
  try {
    if (mode === "create") {
      await createAccount(email, password);
    } else {
      await signIn(email, password);
    }
    window.location.href = "./index.html";
  } catch (err) {
    showError(err?.message || "Authentication failed.");
  } finally {
    setBusy(false);
  }
});

setMode("signin");
