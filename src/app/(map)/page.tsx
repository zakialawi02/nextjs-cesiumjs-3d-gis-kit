import type { Metadata } from "next";

import { AnalysisPanel } from "@/components/map/panels/analysis-panel";
import { DataPanel } from "@/components/map/panels/data-panel";
import { HelpPanel } from "@/components/map/panels/help-panel";
import { LayersPanel } from "@/components/map/panels/layers-panel";
import { CommandBar } from "@/components/map/command-bar";
import { MapControls } from "@/components/map/map-controls";
import { MapEngine } from "@/components/map/map-engine";
import { MapOverlays } from "@/components/map/map-overlays";
import { MobileNav } from "@/components/map/mobile-nav";
import { UploadModal } from "@/components/map/upload-modal";
import { geodataConfig } from "@/config/geodata";
import { env } from "@/env";
import { canUploadData, isAdmin } from "@/lib/roles";
import { requireUser } from "@/server/auth";

export const metadata: Metadata = {
  title: "3D Map Viewer",
};

/**
 * 3D map viewer (port of HomeController@index → pages/map/index.blade.php). The markup is rendered
 * here; <MapEngine> starts the vanilla CesiumJS scripts in the browser (src/lib/map). Client state
 * shared by both sides lives in the map store (src/stores/map-store.ts).
 */
export default async function MapPage() {
  const user = await requireUser();
  const canUpload = canUploadData(user);

  return (
    // Full-bleed globe with floating chrome. Layout and states live in the "Map workspace" section of globals.css.
    <div className="map-app" id="mapApp">
      <div id="cesiumContainer" className="map-canvas"></div>

      <CommandBar
        appName={env.APP_NAME}
        canUploadData={canUpload}
        user={{
          name: user.name,
          email: user.email,
          roleLabel: user.roleLabel,
          isAdmin: isAdmin(user),
          profilePhotoUrl: user.profilePhotoUrl || null,
        }}
      />

      <LayersPanel />

      {canUpload && <DataPanel />}

      <MapControls />
      <MapOverlays />
      <HelpPanel />
      <AnalysisPanel />

      <MobileNav canUploadData={canUpload} />

      {canUpload && (
        <UploadModal
          maxUploadMb={geodataConfig.maxUploadMb}
          utmEpsg={geodataConfig.utm.epsg}
          utmLabel={geodataConfig.utm.label}
        />
      )}

      {/* Renders nothing: starts the map scripts in the browser and stops them on unmount. */}
      <MapEngine userRole={user.role} canUpload={canUpload} />
    </div>
  );
}
