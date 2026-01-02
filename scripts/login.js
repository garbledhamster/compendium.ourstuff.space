import { redirectIfAuthed, createAccount, signIn } from "./authentication.js";

const $ = (s) => document.querySelector(s);

redirectIfAuthed({ redirectTo: "./index.html" });

const errBox = $("#errBox");
const submitBtn = $("#submitBtn");
const modeSignIn = $("#modeSignIn");
const modeCreate = $("#modeCreate");
const showPw = $("#showPw");
const confirmField = $("#confirmField");
const confirmPassword = $("#confirmPassword");
const matchHint = $("#matchHint");

let mode = "signin";

function setMode(next) {
  mode = next;
  modeSignIn.classList.toggle("is-active", mode === "signin");
  modeCreate.classList.toggle("is-active", mode === "create");
  submitBtn.textContent = mode === "signin" ? "Sign In" : "Create Account";
  confirmField.classList.toggle("is-hidden", mode !== "create");
  confirmPassword.required = mode === "create";
  if (mode !== "create") {
    confirmPassword.value = "";
  }
  matchHint.classList.add("is-hidden");
  matchHint.classList.remove("is-good", "is-bad");
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
  confirmPassword.type = showPw.checked ? "text" : "password";
});

function updateMatchHint() {
  if (mode !== "create") return;
  const password = $("#password").value;
  const confirmValue = confirmPassword.value;
  if (!password && !confirmValue) {
    matchHint.classList.add("is-hidden");
    matchHint.classList.remove("is-good", "is-bad");
    matchHint.textContent = "";
    return;
  }

  matchHint.classList.remove("is-hidden");
  if (password && confirmValue && password === confirmValue) {
    matchHint.textContent = "Passwords match.";
    matchHint.classList.add("is-good");
    matchHint.classList.remove("is-bad");
    return;
  }

  matchHint.textContent = "Passwords do not match.";
  matchHint.classList.add("is-bad");
  matchHint.classList.remove("is-good");
}

$("#password").addEventListener("input", updateMatchHint);
confirmPassword.addEventListener("input", updateMatchHint);

$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  clearError();

  const email = $("#email").value.trim();
  const password = $("#password").value;
  const confirmValue = confirmPassword.value;

  if (!email || !password) return showError("Email and password are required.");
  if (mode === "create" && password !== confirmValue) {
    updateMatchHint();
    return showError("Passwords must match to create an account.");
  }

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
