import { createStore } from "zustand/vanilla";

import { THEME_STORAGE_KEY } from "@/lib/theme-script";

/**
 * Light/dark theme (port of the Laravel theme switch): the `dark` class on <html>, persisted in
 * localStorage under "hs_theme". The root layout applies the stored choice before first paint
 * (THEME_INIT_SCRIPT in src/lib/theme-script.ts); this store mirrors and changes it.
 *
 * A vanilla store, so the imperative map scripts can read/subscribe too; React components use
 * `useTheme()` from src/lib/client/theme.ts.
 */
export type Theme = "light" | "dark";

type ThemeState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
}

function persist(theme: Theme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage unavailable: the choice lasts for this page only.
  }
}

export const themeStore = createStore<ThemeState>()((set, get) => ({
  // Server render and hydration start from "light"; syncThemeFromDocument() corrects it on mount.
  theme: "light",
  setTheme: (theme) => {
    applyTheme(theme);
    persist(theme);
    set({ theme });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));

/** Reads the theme the init script applied (call once on the client after hydration). */
export function syncThemeFromDocument(): void {
  const theme: Theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
  if (themeStore.getState().theme !== theme) themeStore.setState({ theme });
}

let listening = false;

/** Keeps tabs in sync when another tab changes the stored theme. Idempotent. */
export function listenForThemeChanges(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    const theme: Theme = event.newValue === "dark" ? "dark" : "light";
    applyTheme(theme);
    themeStore.setState({ theme });
  });
}
