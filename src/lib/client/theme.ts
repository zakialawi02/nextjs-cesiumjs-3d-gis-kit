"use client";

import { useEffect } from "react";
import { useStore } from "zustand";

import { listenForThemeChanges, syncThemeFromDocument, themeStore, type Theme } from "@/stores/theme-store";

export type { Theme };

/**
 * React access to the theme store (src/stores/theme-store.ts). Keeps the
 * `theme / resolvedTheme / setTheme` shape the starter's components used with next-themes.
 */
export function useTheme(): { theme: Theme; resolvedTheme: Theme; setTheme: (theme: Theme) => void } {
  const theme = useStore(themeStore, (state) => state.theme);
  const setTheme = useStore(themeStore, (state) => state.setTheme);

  useEffect(() => {
    syncThemeFromDocument();
    listenForThemeChanges();
  }, []);

  return { theme, resolvedTheme: theme, setTheme };
}
