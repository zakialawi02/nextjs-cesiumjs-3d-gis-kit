import { Check, Info, LocateFixed, Mountain, Pipette, Undo2, X } from "lucide-react";

import { CopyCoordinatesButton } from "./client-controls";

/** Cards and readouts drawn over the globe (feature properties, picked point, cursor coordinates, drawing bar). */
export function MapOverlays() {
  return (
    <>
      {/* Feature properties: filled by CesiumMapController.showFeatureProperties(), hidden with translate-x-[150%]. */}
      <aside
        id="featurePropertiesPanel"
        className="map-card map-card--feature map-sheet translate-x-[150%]"
        aria-labelledby="featurePropertiesTitle"
      >
        <header className="map-card-head">
          <span className="map-card-icon" aria-hidden="true">
            <Info size="1em" />
          </span>
          <h3 id="featurePropertiesTitle" className="map-card-title">
            Feature properties
          </h3>
          {/* Wired to CesiumMapController#hideFeatureProperties() by initMapPage() in src/lib/map/cesium-map.js. */}
          <button
            type="button"
            id="closeFeaturePropertiesBtn"
            className="map-icon-btn"
            aria-label="Close feature properties"
          >
            <X size="1em" aria-hidden="true" />
          </button>
        </header>
        <div className="map-card-body">
          <div id="featurePropertiesContent"></div>
        </div>
      </aside>

      {/* Picked point (coordinate picker mode) */}
      <aside
        id="coordinatePickerPopup"
        className="map-card map-card--point map-sheet hidden"
        aria-labelledby="coordinatePickerTitle"
      >
        <header className="map-card-head">
          <span className="map-card-icon" aria-hidden="true">
            <Pipette size="1em" />
          </span>
          <h3 id="coordinatePickerTitle" className="map-card-title">
            Picked point
          </h3>
          <CopyCoordinatesButton />
          <button
            type="button"
            id="closeCoordinatePickerPopupBtn"
            className="map-icon-btn"
            aria-label="Stop picking coordinates"
            data-tip="Stop picking"
          >
            <X size="1em" aria-hidden="true" />
          </button>
        </header>

        <div className="map-card-body" aria-live="polite">
          <div id="pickWgsGroup" className="grid grid-cols-2 gap-2">
            <div className="map-readout">
              <span className="map-readout-label">Latitude</span>
              <span id="pickLatVal" className="map-readout-value">
                -
              </span>
            </div>
            <div className="map-readout">
              <span className="map-readout-label">Longitude</span>
              <span id="pickLngVal" className="map-readout-value">
                -
              </span>
            </div>
          </div>

          <div id="pickUtmGroup" className="hidden grid-cols-2 gap-2">
            <div className="map-readout">
              <span className="map-readout-label">UTM X (easting)</span>
              <span id="pickUtmXVal" className="map-readout-value">
                -
              </span>
            </div>
            <div className="map-readout">
              <span className="map-readout-label">UTM Y (northing)</span>
              <span id="pickUtmYVal" className="map-readout-value">
                -
              </span>
            </div>
          </div>

          <div className="map-readout map-readout--accent mt-2">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="map-readout-label">Elevation (Z)</span>
              <span id="pickZVal" className="map-readout-value">
                -
              </span>
            </span>
            <Mountain size="1em" className="text-lg" aria-hidden="true" />
          </div>

          <p className="map-card-note">
            Click the map to pick another point. Clicks snap to nearby vector vertices.
          </p>
        </div>
      </aside>

      {/* Cursor coordinates (pointer devices, md+). Shown by initMousePosition() through opacity-0 / opacity-100. */}
      <div id="coordinateOverlay" className="map-hud map-glass opacity-0" aria-hidden="true">
        <LocateFixed size="1em" className="text-sm text-map-subtle" aria-hidden="true" />
        <div id="coordWgsGroup" className="flex items-center gap-3">
          <span className="map-hud-item">
            <span className="map-hud-key">Lat</span>
            <span id="latValue" className="map-hud-value">
              -
            </span>
          </span>
          <span className="map-hud-item">
            <span className="map-hud-key">Lon</span>
            <span id="longValue" className="map-hud-value">
              -
            </span>
          </span>
        </div>
        <div id="coordUtmGroup" className="hidden items-center gap-3">
          <span className="map-hud-item">
            <span className="map-hud-key">X</span>
            <span id="xValue" className="map-hud-value">
              -
            </span>
          </span>
          <span className="map-hud-item">
            <span className="map-hud-key">Y</span>
            <span id="yValue" className="map-hud-value">
              -
            </span>
          </span>
        </div>
        <span className="map-hud-tag">WGS84</span>
      </div>

      {/* Drawing control bar (shown while a measure or analysis tool is drawing) */}
      <div
        id="drawingControlBar"
        className="map-drawbar map-glass hidden"
        role="status"
        aria-live="polite"
      >
        <div className="map-drawbar-text">
          <span className="map-pulse" aria-hidden="true"></span>
          <span id="drawingControlBarText">Drawing...</span>
        </div>
        <button id="drawingControlFinishPartBtn" type="button" className="hidden"></button>
        <button id="drawingControlUndoBtn" type="button" className="map-btn map-btn-ghost hidden">
          <Undo2 size="1em" aria-hidden="true" />
          <span>Undo</span>
        </button>
        <button id="drawingControlCancelBtn" type="button" className="map-btn map-btn-ghost">
          Cancel
        </button>
        <button id="drawingControlDoneBtn" type="button" className="map-btn map-btn-primary">
          <Check size="1em" aria-hidden="true" />
          <span>Done</span>
        </button>
      </div>
    </>
  );
}
