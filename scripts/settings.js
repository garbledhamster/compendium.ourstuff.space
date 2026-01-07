import {
  getUserUiSettings,
  setUserUiSettings,
  getUserProfile,
  setUserProfile
} from "./firebase.js";
import { applyTheme, pickTheme } from "./themes.js";

const THEME_STORAGE_KEY = "compendium.themeId";

export async function initSettings({
  user,
  themes,
  themeSelectEl,
  postNameInputEl,
  postNameSaveEl,
  postNameHintEl,
  onProfileChange
}) {
  const hasThemes = Array.isArray(themes) && themes.length;
  // If themes.yaml failed, keep CSS defaults and disable selector gracefully.
  if (!hasThemes && themeSelectEl) {
    themeSelectEl.innerHTML = `<option value="monokai-dark">Monokai (Dark)</option>`;
    themeSelectEl.disabled = true;
  }

  // Load user setting
  let themeId = "monokai-dark";
  let postName = "";
  try {
    const storedThemeId = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedThemeId) themeId = storedThemeId;
  } catch {}
  try {
    const data = await getUserUiSettings(user.uid);
    if (data?.themeId) themeId = data.themeId;
  } catch {}
  try {
    const profile = await getUserProfile(user.uid);
    if (profile?.displayName) postName = profile.displayName;
  } catch {}

  let chosen = null;
  if (hasThemes) {
    // Apply
    chosen = pickTheme(themes, themeId, "monokai-dark");
    applyTheme(chosen);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, chosen.id);
    } catch {}

    // Populate UI
    themeSelectEl.innerHTML = "";
    for (const t of themes) {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.label || t.id;
      themeSelectEl.appendChild(opt);
    }
    themeSelectEl.value = chosen.id;
    themeSelectEl.disabled = false;

    themeSelectEl.addEventListener("change", async () => {
      const next = pickTheme(themes, themeSelectEl.value, "monokai-dark");
      if (!next) return;
      applyTheme(next);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next.id);
      } catch {}

      try {
        await setUserUiSettings(user.uid, { themeId: next.id });
      } catch {}
    });
  }

  if (postNameInputEl && postNameSaveEl) {
    const setHint = (msg, state = "") => {
      if (!postNameHintEl) return;
      postNameHintEl.textContent = msg;
      postNameHintEl.classList.remove("is-hidden", "is-good", "is-bad");
      if (state) postNameHintEl.classList.add(state);
    };
    const clearHint = () => {
      if (!postNameHintEl) return;
      postNameHintEl.textContent = "";
      postNameHintEl.classList.add("is-hidden");
      postNameHintEl.classList.remove("is-good", "is-bad");
    };
    postNameInputEl.value = postName;

    postNameInputEl.addEventListener("input", () => clearHint());
    postNameInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        postNameSaveEl.click();
      }
    });

    postNameSaveEl.addEventListener("click", async () => {
      const nextName = postNameInputEl.value.trim();
      if (!nextName) {
        setHint("Post name is required.", "is-bad");
        return;
      }
      try {
        await setUserProfile(user.uid, { displayName: nextName });
        postName = nextName;
        setHint("Post name saved.", "is-good");
        if (onProfileChange) onProfileChange(nextName);
      } catch {
        setHint("Unable to save post name.", "is-bad");
      }
    });
  }

  return { themeId: chosen?.id || "monokai-dark", postName };
}
