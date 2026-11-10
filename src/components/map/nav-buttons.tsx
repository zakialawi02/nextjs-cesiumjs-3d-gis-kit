"use client";

import type { ReactNode } from "react";

import { useMapStore, type MapPanel } from "@/stores/map-store";

/**
 * Side-panel switches (ports of x-map-nav-button and x-mobile-nav-button). Their open state is
 * mapStore.activePanel (src/stores/map-store.ts); the shortcuts in src/lib/map/map-page.js use the
 * same store, so buttons, shortcuts and close buttons stay in sync.
 */

type NavButtonProps = {
  panel: MapPanel;
  /** A lucide-react icon rendered by the caller (server component), e.g. `<Layers size="1em" />`. */
  icon: ReactNode;
  label: string;
  /** Shows the number of uploads in progress (Data panel). */
  badgeId?: string;
};

/** Number of upload cards in the Data panel (mapStore.uploads). */
function UploadBadge({ id }: { id: string }) {
  const count = useMapStore((state) => state.uploads.length);
  return (
    <span id={id} className="map-badge" hidden={count === 0}>
      {count > 99 ? "99+" : count}
    </span>
  );
}

function usePanelSwitch(panel: MapPanel) {
  const open = useMapStore((state) => state.activePanel === panel);
  const togglePanel = useMapStore((state) => state.togglePanel);
  return { open, toggle: () => togglePanel(panel) };
}

/** Command bar switch for a side panel. */
export function MapNavButton({
  panel,
  icon,
  label,
  shortcut,
  badgeId,
}: NavButtonProps & { shortcut?: string }) {
  const { open, toggle } = usePanelSwitch(panel);

  return (
    <button
      type="button"
      id={`${panel}ToggleBtn`}
      className={open ? "map-nav-btn active" : "map-nav-btn"}
      aria-controls={`${panel}Panel`}
      aria-expanded={open}
      aria-label={label}
      data-tip={shortcut ? `${label} (${shortcut})` : label}
      data-tip-side="bottom"
      aria-keyshortcuts={shortcut || undefined}
      onClick={toggle}
    >
      {icon}
      <span>{label}</span>
      {badgeId && <UploadBadge id={badgeId} />}
    </button>
  );
}

/** Phone bottom-bar switch for a side panel. */
export function MobileNavButton({ panel, icon, label, badgeId }: NavButtonProps) {
  const { open, toggle } = usePanelSwitch(panel);

  return (
    <button
      type="button"
      id={`${panel}ToggleBtnMobile`}
      className={open ? "map-tab active" : "map-tab"}
      aria-controls={`${panel}Panel`}
      aria-expanded={open}
      aria-label={label}
      onClick={toggle}
    >
      <span id={`${panel}IconContainerMobile`} className="map-tab-icon">
        {icon}
        {badgeId && <UploadBadge id={badgeId} />}
      </span>
      <span id={`${panel}LabelMobile`} className="map-tab-label">
        {label}
      </span>
    </button>
  );
}
