import { create } from "zustand";

/**
 * Dashboard chrome state: the off-canvas sidebar below `lg`, opened by the header's menu button and
 * closed by the sidebar's X button, its backdrop, Escape and every navigation
 * (src/components/app/app-shell.tsx).
 *
 * A module-level store is safe here: it only changes in event handlers and effects (never during a
 * server render), and zustand's `useStore` renders the server snapshot from `getInitialState()`, so
 * each request's HTML starts with the sidebar closed regardless of what any browser did.
 */
type UiState = {
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
};

export const useUiStore = create<UiState>()((set) => ({
  sidebarOpen: false,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
}));
