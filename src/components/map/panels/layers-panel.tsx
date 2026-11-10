import { skeleton } from "@/lib/map/templates";

import { LayerFilterControls, PanelCloseButton, SidePanel } from "../client-controls";

/** Layers panel: floating card under the command bar (md+), bottom sheet on phones. */
export function LayersPanel() {
  return (
    <SidePanel panel="layers" labelledBy="layersPanelTitle">
      <span className="map-sheet-grabber" aria-hidden="true"></span>

      <header className="map-panel-head">
        <div className="min-w-0 flex-1">
          <h2 id="layersPanelTitle" className="map-panel-title">
            Layers
          </h2>
          <p className="map-panel-sub">Show terrain, orthophoto and vector data on the globe.</p>
        </div>
        <PanelCloseButton id="closeLayersBtn" label="Close layers panel" />
      </header>

      <LayerFilterControls />

      <div className="map-panel-body">
        {/* Filled from /geodata/layers/all by src/lib/map/map-page.js (innerHTML), so React leaves it alone. */}
        <div
          id="allLayersList"
          dangerouslySetInnerHTML={{ __html: skeleton({ count: 4, id: "layersLoading" }) }}
        />
      </div>
    </SidePanel>
  );
}
