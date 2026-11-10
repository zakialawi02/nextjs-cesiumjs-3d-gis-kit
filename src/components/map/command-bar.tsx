import { Database, Layers } from "lucide-react";

import { ApplicationLogo } from "@/components/application-logo";

import { MapNavButton } from "./nav-buttons";
import { UserDropdownMenu, type MapMenuUser } from "./user-dropdown-menu";

/** Floating command bar: brand, side-panel switches and account menu (every breakpoint). */
export function CommandBar({
  appName,
  canUploadData,
  user,
}: {
  appName: string;
  canUploadData: boolean;
  user: MapMenuUser;
}) {
  return (
    <header className="map-bar map-glass">
      {/* Plain link: like Laravel, the brand reloads the map page. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/" className="map-brand" aria-label={appName}>
        <ApplicationLogo className="size-8 shrink-0" alt={appName} />
        <span className="map-brand-text">
          <span className="map-brand-name">{appName}</span>
          <span className="map-brand-sub">3D map viewer</span>
        </span>
      </a>

      <nav className="map-nav" aria-label="Main navigation">
        <MapNavButton panel="layers" icon={<Layers size="1em" />} label="Layers" shortcut="L" />

        {canUploadData && (
          <MapNavButton
            panel="data"
            icon={<Database size="1em" />}
            label="Data"
            shortcut="D"
            badgeId="uploadCount"
          />
        )}
      </nav>

      <UserDropdownMenu buttonId="userMenuBtn" dropdownId="userDropdown" user={user} />
    </header>
  );
}
