/**
 * Shared by the root layout (server) and src/lib/client/theme.ts (browser). Kept out of the
 * "use client" module so the server layout gets the real string, not a client reference.
 */
export const THEME_STORAGE_KEY = "hs_theme";

/** Inline <head> script: applies the stored theme before the page paints (as the Laravel layouts did). */
export const THEME_INIT_SCRIPT = `try{if(localStorage.getItem("${THEME_STORAGE_KEY}")==="dark"){document.documentElement.classList.add("dark");document.documentElement.style.colorScheme="dark"}}catch(e){}`;
