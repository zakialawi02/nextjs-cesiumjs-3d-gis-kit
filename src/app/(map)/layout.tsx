import type { ReactNode } from "react";

import { MapDocumentClasses } from "@/components/map/map-document-classes";

/**
 * Full-viewport shell of the map page (port of layouts/app-front.blade.php): no page scrolling,
 * no overscroll; the globe and its floating chrome fill the screen.
 */
export default function MapLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <MapDocumentClasses />
      <main className="h-full w-full overflow-hidden overscroll-none">{children}</main>
    </>
  );
}
