import { Database, Layers } from "lucide-react";

import { MobileNavButton } from "./nav-buttons";

/** Phone bottom navigation (hidden from md up, where the switches live in the command bar). */
export function MobileNav({ canUploadData }: { canUploadData: boolean }) {
  return (
    <nav aria-label="Main navigation" className="map-tabbar map-glass">
      <MobileNavButton panel="layers" icon={<Layers size="1em" />} label="Layers" />

      {canUploadData && (
        <MobileNavButton
          panel="data"
          icon={<Database size="1em" />}
          label="Data"
          badgeId="uploadCountMobile"
        />
      )}
    </nav>
  );
}
