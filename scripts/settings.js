import { getUserUiSettings, setUserUiSettings } from "./firebase.js";
import { applyTheme, pickTheme } from "./themes.js";

const THEME_STORAGE_KEY = "compendium.themeId";

export async function initSettings({ user, themes, themeSelectEl }) {
  // If themes.yaml failed, keep CSS defaults and disable selector gracefully.
  if (!Array.isArray(themes) || !themes.length) {
    if (themeSelectEl) {
      themeSelectEl.innerHTML = `<option value="monokai-dark">Monokai (Dark)</option>`;
      themeSelectEl.disabled = true;
    }
    return { themeId: "monokai-dark" };
  }

  // Load user setting
  let themeId = "monokai-dark";
  try {
    const storedThemeId = localStorage.getItem(THEME_STORAGE_KEY);
    if (storedThemeId) themeId = storedThemeId;
  } catch {}
  try {
    const data = await getUserUiSettings(user.uid);
    if (data?.themeId) themeId = data.themeId;
  } catch {}

  // Apply
  const chosen = pickTheme(themes, themeId, "monokai-dark");
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

  return { themeId: chosen.id };
}
