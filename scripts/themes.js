import yaml from "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm";

export async function loadThemesFromYaml({ allowedIds = null } = {}) {
  const res = await fetch("./themes.yaml", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load themes.yaml (must exist at site root).");

  const text = await res.text();
  const parsed = yaml.load(text);

  if (!Array.isArray(parsed)) throw new Error("themes.yaml must be a list of theme objects.");

  let themes = parsed
    .filter(t => t && t.id && t.colors);

  if (Array.isArray(allowedIds) && allowedIds.length) {
    themes = themes.filter(t => allowedIds.includes(t.id));
  }

  return themes;
}

export function applyTheme(theme) {
  const c = theme?.colors || {};
  const r = document.documentElement;

  r.style.setProperty("--primary", c.primaryColor);
  r.style.setProperty("--secondary", c.secondaryColor);
  r.style.setProperty("--bg", c.backgroundColor);
  r.style.setProperty("--surface", c.surfaceColor);
  r.style.setProperty("--surface-muted", c.surfaceMutedColor);
  r.style.setProperty("--border", c.borderColor);
  r.style.setProperty("--text", c.textColor);
  r.style.setProperty("--muted", c.textMutedColor);
  r.style.setProperty("--danger", c.dangerColor);
  r.style.setProperty("--overlay", c.textColor);
  r.style.setProperty("--overlay-text", c.backgroundColor);

  r.dataset.theme = theme.id;
}

export function pickTheme(themes, themeId, fallbackId = null) {
  if (!Array.isArray(themes) || !themes.length) return null;
  if (themeId) {
    const found = themes.find(t => t.id === themeId);
    if (found) return found;
  }
  if (fallbackId) {
    const found = themes.find(t => t.id === fallbackId);
    if (found) return found;
  }
  return themes[0];
}
