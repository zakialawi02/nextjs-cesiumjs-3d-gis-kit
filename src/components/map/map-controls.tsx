import {
  CircleQuestionMark,
  Minus,
  Navigation,
  Orbit,
  Pipette,
  Plus,
  Ruler,
} from "lucide-react";
import { Fragment, type CSSProperties } from "react";

type MeasureTool = { id: string; glyph: string | null; label: string; title: string };

const MEASURE_GROUPS: Array<[string, MeasureTool[]]> = [
  [
    "Distance",
    [
      {
        id: "measureDistanceHorizBtn",
        glyph: "measure-distance-planar",
        label: "Planar",
        title: "Planar distance",
      },
      {
        id: "measureDistanceSurfBtn",
        glyph: "measure-distance-surface",
        label: "Surface",
        title: "Surface distance (follows terrain)",
      },
    ],
  ],
  [
    "Area",
    [
      {
        id: "measureAreaHorizBtn",
        glyph: "measure-area-planar",
        label: "Planar",
        title: "Planar area",
      },
      {
        id: "measureAreaSurfBtn",
        glyph: "measure-area-surface",
        label: "Surface",
        title: "Surface area (follows terrain)",
      },
    ],
  ],
  [
    "Shape & terrain",
    [
      { id: "measureCircleBtn", glyph: null, label: "Circle", title: "Circle radius and area" },
      {
        id: "measureAnalysisBtn",
        glyph: "measure-analysis",
        label: "Vol / Profile",
        title: "Cut & fill volume and elevation profile",
      },
    ],
  ],
];

/** `.map-glyph` mask image (an SVG in public/assets/img/icons). */
export function glyphStyle(name: string): CSSProperties {
  return { "--glyph": `url('/assets/img/icons/${name}.svg')` } as CSSProperties;
}

/**
 * Map tools (top right) and camera navigation (bottom right). [data-map-tool] buttons get
 * aria-pressed from applyBtnStyle() in src/lib/map/cesium-map.js.
 */
export function MapControls() {
  return (
    <>
      <div className="map-rail map-rail--tools map-glass" role="group" aria-label="Map tools">
        <button
          type="button"
          id="coordinatePickerBtn"
          className="map-tool"
          data-map-tool=""
          aria-pressed="false"
          aria-label="Pick coordinates"
          data-tip="Pick coordinates"
        >
          <Pipette size="1em" aria-hidden="true" />
        </button>
        <button
          type="button"
          id="pivotCamBtn"
          className="map-tool"
          data-map-tool=""
          aria-pressed="false"
          aria-label="Pivot camera"
          data-tip="Orbit around a point"
        >
          <Orbit size="1em" aria-hidden="true" />
        </button>
        <button
          type="button"
          id="geolocationBtn"
          className="map-tool"
          data-map-tool=""
          aria-pressed="false"
          aria-label="My location"
          data-tip="My location"
        >
          <Navigation size="1em" aria-hidden="true" />
        </button>

        <span className="map-rail-sep" aria-hidden="true"></span>

        <div className="map-measure relative">
          <button
            type="button"
            id="measureToggleBtn"
            className="map-tool"
            aria-haspopup="true"
            aria-expanded="false"
            aria-controls="measurePanel"
            aria-label="Measure tools"
            data-tip="Measure"
          >
            <Ruler size="1em" aria-hidden="true" />
          </button>

          <div
            id="measurePanel"
            className="map-flyout map-sheet pointer-events-none scale-95 opacity-0"
            role="group"
            aria-labelledby="measurePanelTitle"
          >
            <p id="measurePanelTitle" className="map-flyout-title">
              Measure
            </p>
            {MEASURE_GROUPS.map(([group, tools]) => (
              <Fragment key={group}>
                <p className="map-flyout-label">{group}</p>
                <div className="grid grid-cols-2 gap-1">
                  {tools.map((tool) => (
                    <button
                      key={tool.id}
                      type="button"
                      id={tool.id}
                      className="map-flyout-tool"
                      data-map-tool=""
                      aria-pressed="false"
                      aria-label={tool.title}
                      title={tool.title}
                    >
                      {tool.glyph ? (
                        <span
                          className="map-glyph"
                          style={glyphStyle(tool.glyph)}
                          aria-hidden="true"
                        ></span>
                      ) : (
                        <svg
                          viewBox="0 0 24 24"
                          className="size-[1.125rem] flex-none"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="9" />
                          <line x1="12" y1="12" x2="18.36" y2="5.64" />
                          <circle cx="12" cy="12" r="1.2" fill="currentColor" />
                        </svg>
                      )}
                      <span>{tool.label}</span>
                    </button>
                  ))}
                </div>
              </Fragment>
            ))}
          </div>
        </div>

        <button
          type="button"
          id="helpBtn"
          className="map-tool"
          aria-haspopup="true"
          aria-expanded="false"
          aria-controls="cesiumHelpPanel"
          aria-label="Map help"
          data-tip="Help"
        >
          <CircleQuestionMark size="1em" aria-hidden="true" />
        </button>
      </div>

      {/* Camera navigation (bottom right) */}
      <div className="map-rail map-rail--nav map-glass" role="group" aria-label="Camera">
        <button
          type="button"
          id="compassBtn"
          className="map-tool map-compass"
          aria-label="Reset north, then top view"
          data-tip="Reset north / top view"
        >
          <span id="compassIcon">
            <svg viewBox="0 0 24 24" className="size-6" aria-hidden="true">
              <circle
                cx="12"
                cy="12"
                r="9.5"
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeWidth="1.5"
              />
              <path d="M12 3.6 14.9 12H9.1Z" fill="#e5484d" />
              <path d="M12 20.4 9.1 12h5.8Z" fill="currentColor" fillOpacity="0.5" />
              <circle cx="12" cy="12" r="1.4" style={{ fill: "var(--map-surface-strong)" }} />
            </svg>
          </span>
        </button>

        <span className="map-rail-sep" aria-hidden="true"></span>

        <button
          type="button"
          id="zoomInBtn"
          className="map-tool"
          aria-label="Zoom in"
          data-tip="Zoom in"
        >
          <Plus size="1em" aria-hidden="true" />
        </button>
        <button
          type="button"
          id="zoomOutBtn"
          className="map-tool"
          aria-label="Zoom out"
          data-tip="Zoom out"
        >
          <Minus size="1em" aria-hidden="true" />
        </button>
      </div>
    </>
  );
}
