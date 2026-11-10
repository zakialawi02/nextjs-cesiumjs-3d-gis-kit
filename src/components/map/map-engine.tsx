"use client";

import "cesium/Build/Cesium/Widgets/widgets.css";

import { useEffect } from "react";

import { resetMapStore } from "@/stores/map-store";

type MapEngineProps = {
  userRole: string;
  canUpload: boolean;
};

type MapWindow = Window & { CESIUM_BASE_URL?: string };

/**
 * Starts the imperative map scripts (CesiumJS controller, panels, uploads) once the page markup is
 * in the DOM, and tears everything down on unmount (port of window.cleanupMapPage), including the
 * map store (src/stores/map-store.ts). Cesium is loaded with a dynamic import() so it never runs
 * on the server. Renders nothing.
 */
export function MapEngine({ userRole, canUpload }: MapEngineProps) {
  useEffect(() => {
    let cancelled = false;
    let unmount: (() => void) | undefined;

    // The root layout sets this in <head>; keep it in place before Cesium resolves asset URLs.
    const mapWindow = window as MapWindow;
    mapWindow.CESIUM_BASE_URL = mapWindow.CESIUM_BASE_URL || "/cesium/";

    import("@/lib/map/mount")
      .then(({ mountMap }) => {
        if (cancelled) return;
        unmount = mountMap({ userRole, canUpload });
      })
      .catch((error) => console.error("Failed to load the map:", error));

    return () => {
      cancelled = true;
      if (unmount) {
        unmount(); // also resets the map store
      } else {
        // Left before the scripts loaded: still start clean next time.
        resetMapStore();
      }
    };
  }, [userRole, canUpload]);

  return null;
}
