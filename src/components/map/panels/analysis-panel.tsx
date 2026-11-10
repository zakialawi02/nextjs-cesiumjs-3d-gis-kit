import { ChartLine, LoaderCircle, PencilRuler, SquarePen, type LucideIcon } from "lucide-react";

import { DecimalInput } from "../client-controls";
import { glyphStyle } from "../map-controls";
import { ButtonClose } from "../ui";

const TABS: Array<{ id: string; label: string; icon: LucideIcon | null }> = [
  { id: "cut-fill", label: "Cut & fill", icon: null },
  { id: "profile-section", label: "Profile", icon: ChartLine },
];

function SwitchRow({
  id,
  title,
  help,
  defaultChecked = false,
}: {
  id: string;
  title: string;
  help: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="map-switch-row">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[0.8125rem] font-semibold text-map-ink">{title}</span>
        <span className="map-help-text">{help}</span>
      </span>
      <span className="map-switch">
        <input type="checkbox" id={id} className="peer sr-only" defaultChecked={defaultChecked} />
        <span className="map-switch-track" aria-hidden="true"></span>
      </span>
    </label>
  );
}

function Stat({
  label,
  id,
  valueClass = "",
  className = "",
}: {
  label: string;
  id: string;
  valueClass?: string;
  className?: string;
}) {
  return (
    <div className={`map-stat ${className}`.trim()}>
      <span className="map-stat-label">{label}</span>
      <span id={id} className={`map-stat-value ${valueClass}`.trim()}>
        -
      </span>
    </div>
  );
}

/**
 * Vol/Profile analysis: top-right card on md+, bottom sheet on phones.
 * src/lib/map/cesium-map.js toggles .active, hides the panel while drawing and fills every id below.
 */
export function AnalysisPanel() {
  return (
    <div
      id="analysisPanel"
      className="map-analysis map-sheet"
      role="dialog"
      aria-labelledby="analysisPanelTitle"
    >
      <span className="map-sheet-grabber" aria-hidden="true"></span>

      <div id="analysisNormalContent" className="flex min-h-0 flex-1 flex-col">
        <header className="map-panel-head">
          <div className="min-w-0 flex-1">
            <h3 id="analysisPanelTitle" className="map-panel-title">
              Terrain analysis
            </h3>
            <p className="map-panel-sub">Runs on the active terrain layer.</p>
          </div>
          <ButtonClose id="closeAnalysisBtn" aria-label="Close analysis" />
        </header>

        <div className="flex-none px-3 pb-3">
          <div className="map-segmented" role="tablist" aria-label="Analysis tools">
            {TABS.map(({ icon: TabIcon, ...tab }, index) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${tab.id}-tab-btn`}
                aria-controls={`${tab.id}-tab`}
                aria-selected={index === 0 ? "true" : "false"}
                data-analysis-tab=""
                className="map-segment"
              >
                {TabIcon ? (
                  <TabIcon size="1em" className="text-sm" aria-hidden="true" />
                ) : (
                  <span
                    className="map-glyph size-3.5"
                    style={glyphStyle("analysis-cut-fill")}
                    aria-hidden="true"
                  ></span>
                )}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="map-panel-body px-3.5">
          {/* Cut & fill */}
          <div
            id="cut-fill-tab"
            role="tabpanel"
            aria-labelledby="cut-fill-tab-btn"
            className="flex flex-col gap-5"
          >
            <section className="map-step">
              <h4 className="map-step-title">
                <span className="map-step-num">1</span>Draw the area
              </h4>
              <button
                id="cutFillDrawBtn"
                type="button"
                className="map-btn w-full"
                data-map-action=""
                data-variant="primary"
              >
                <SquarePen size="1em" aria-hidden="true" />
                <span id="cutFillDrawBtnText">Draw area</span>
              </button>
              <p className="map-help-text">
                Click to add points. Double-click or press Done to close the polygon.
              </p>
            </section>

            <section className="map-step">
              <h4 className="map-step-title">
                <span className="map-step-num">2</span>Set the parameters
              </h4>

              <div className="map-form-row">
                <label htmlFor="cutFillResolution" className="map-form-label">
                  Grid resolution
                </label>
                <select id="cutFillResolution" className="map-field" defaultValue="3">
                  <option value="1">1 m (slow)</option>
                  <option value="2">2 m</option>
                  <option value="3">3 m (balanced)</option>
                  <option value="4">4 m</option>
                  <option value="5">5 m</option>
                  <option value="10">10 m (fast)</option>
                </select>
              </div>

              <div className="map-form-row">
                <label htmlFor="cutFillTargetType" className="map-form-label">
                  Target surface
                </label>
                <select id="cutFillTargetType" className="map-field" defaultValue="flat">
                  <option value="flat">Flat elevation</option>
                  <option value="boundary">Polygon boundary (vertex heights)</option>
                  <option value="terrain">Another terrain layer</option>
                </select>
              </div>

              <div id="cutFillFlatGroup" className="map-form-row">
                <label htmlFor="cutFillTargetElevation" className="map-form-label">
                  Target elevation
                </label>
                <div className="relative">
                  <DecimalInput
                    id="cutFillTargetElevation"
                    defaultValue="0.0"
                    className="map-field pr-9 tabular-nums"
                  />
                  <span className="map-field-unit">m</span>
                </div>
              </div>

              <div id="cutFillBoundaryOffsetGroup" className="map-form-row hidden">
                <label htmlFor="cutFillBoundaryOffset" className="map-form-label">
                  Boundary height offset
                </label>
                <div className="relative">
                  <DecimalInput
                    id="cutFillBoundaryOffset"
                    defaultValue="0.0"
                    className="map-field pr-9 tabular-nums"
                    aria-describedby="cutFillBoundaryOffsetHint"
                  />
                  <span className="map-field-unit">m</span>
                </div>
                <p id="cutFillBoundaryOffsetHint" className="map-help-text">
                  Added to the boundary vertex heights (+/- metres).
                </p>
              </div>

              <div id="cutFillTerrainGroup" className="map-form-row hidden">
                <label htmlFor="cutFillCompareTerrain" className="map-form-label">
                  Comparison terrain
                </label>
                <div className="relative">
                  {/* Options are replaced by fetchComparisonTerrains() in cesium-map.js. */}
                  <select id="cutFillCompareTerrain" className="map-field" defaultValue="">
                    <option value="">Loading terrains...</option>
                  </select>
                  <span
                    id="cutFillCompareTerrainSpinner"
                    className="pointer-events-none absolute right-9 top-1/2 hidden -translate-y-1/2 text-map-accent-ink"
                  >
                    <LoaderCircle size="1em" className="animate-spin text-sm" aria-hidden="true" />
                  </span>
                </div>
              </div>
            </section>

            <div className="grid grid-cols-2 gap-2">
              <button id="cutFillClearBtn" type="button" className="map-btn map-btn-secondary">
                Clear
              </button>
              <button
                id="cutFillCalculateBtn"
                type="button"
                className="map-btn map-btn-primary"
                disabled
              >
                Calculate volume
              </button>
            </div>

            <div id="cutFillResultsSection" className="map-results hidden" aria-live="polite">
              <h4 className="map-step-title">Results</h4>
              <div className="map-stat-grid">
                <Stat
                  label="Cut volume"
                  id="cutFillResultCut"
                  valueClass="text-map-danger"
                  className="map-stat--cut"
                />
                <Stat
                  label="Fill volume"
                  id="cutFillResultFill"
                  valueClass="text-map-accent-ink"
                  className="map-stat--fill"
                />
              </div>
              <dl className="map-result-list">
                <div>
                  <dt>Net volume (cut − fill)</dt>
                  <dd id="cutFillResultNet">-</dd>
                </div>
                <div>
                  <dt>Planar area (2D)</dt>
                  <dd id="cutFillResultPlanarArea">-</dd>
                </div>
                <div className="hidden">
                  <dt>Surface area (3D)</dt>
                  <dd id="cutFillResultSurfaceArea">-</dd>
                </div>
                <div>
                  <dt>Average depth (cut/fill)</dt>
                  <dd id="cutFillResultAvgDepth">-</dd>
                </div>
              </dl>
            </div>

            <section className="map-step">
              <h4 className="map-step-title">Display</h4>
              <SwitchRow
                id="cutFillToggleHeatmap"
                title="Heatmap grid"
                help="Colour grid cells by cut/fill depth"
                defaultChecked
              />
              <SwitchRow
                id="cutFillTogglePoints"
                title="Grid points"
                help="Show the sampled terrain nodes"
              />
            </section>
          </div>

          {/* Elevation profile */}
          <div
            id="profile-section-tab"
            role="tabpanel"
            aria-labelledby="profile-section-tab-btn"
            className="flex hidden flex-col gap-5"
          >
            <section className="map-step">
              <h4 className="map-step-title">
                <span className="map-step-num">1</span>Draw the profile line
              </h4>
              <button
                id="profileDrawBtn"
                type="button"
                className="map-btn w-full"
                data-map-action=""
                data-variant="primary"
              >
                <PencilRuler size="1em" aria-hidden="true" />
                <span id="profileDrawBtnText">Draw profile line</span>
              </button>
              <p className="map-help-text">
                Click to add points. Double-click or press Done to finish the line.
              </p>
            </section>

            <section className="map-step">
              <h4 className="map-step-title">
                <span className="map-step-num">2</span>Set the parameters
              </h4>

              <div className="map-form-row">
                <label htmlFor="profileSampleInterval" className="map-form-label">
                  Sampling interval
                </label>
                <select id="profileSampleInterval" className="map-field" defaultValue="3">
                  <option value="0.5">0.5 m (high detail)</option>
                  <option value="1">1 m</option>
                  <option value="2">2 m</option>
                  <option value="3">3 m (balanced)</option>
                  <option value="5">5 m (fast)</option>
                </select>
              </div>

              <div className="map-form-row">
                <label htmlFor="profileMode" className="map-form-label">
                  Mode
                </label>
                <select id="profileMode" className="map-field" defaultValue="single">
                  <option value="single">Single (active terrain only)</option>
                  <option value="double">Compare (active + another terrain)</option>
                </select>
              </div>

              <div id="profileTerrainGroup" className="map-form-row hidden">
                <label htmlFor="profileCompareTerrain" className="map-form-label">
                  Comparison terrain
                </label>
                <div className="relative">
                  {/* Options are replaced by fetchComparisonTerrains() in cesium-map.js. */}
                  <select id="profileCompareTerrain" className="map-field" defaultValue="">
                    <option value="">Loading terrains...</option>
                  </select>
                  <span
                    id="profileCompareTerrainSpinner"
                    className="pointer-events-none absolute right-9 top-1/2 hidden -translate-y-1/2 text-map-accent-ink"
                  >
                    <LoaderCircle size="1em" className="animate-spin text-sm" aria-hidden="true" />
                  </span>
                </div>
              </div>
            </section>

            <section className="map-step">
              <h4 className="map-step-title">Display</h4>
              <SwitchRow
                id="settingElevationBand"
                title="Elevation colour bands"
                help="Colour the terrain by height"
              />
            </section>

            <div className="grid grid-cols-2 gap-2">
              <button id="profileClearBtn" type="button" className="map-btn map-btn-secondary">
                Clear
              </button>
              <button
                id="profileGenerateBtn"
                type="button"
                className="map-btn map-btn-primary"
                disabled
              >
                Generate profile
              </button>
            </div>

            <div id="profileResultsSection" className="map-results hidden" aria-live="polite">
              <h4 className="map-step-title">Elevation profile</h4>
              <div className="overflow-hidden rounded-[0.625rem] border border-map-line bg-map-surface-strong p-1">
                <canvas
                  id="profileChart"
                  className="h-44 w-full"
                  role="img"
                  aria-label="Elevation profile chart"
                ></canvas>
              </div>
              <div
                id="profileChartLegend"
                className="flex hidden items-center justify-center gap-4 text-[0.6875rem] font-semibold text-map-muted"
              >
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-3 rounded-sm bg-[#6366f1]"></span>Active
                  terrain
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-1.5 w-3 rounded-sm bg-[#f97316]"></span>Comparison
                  terrain
                </span>
              </div>
              <div className="map-stat-grid">
                <Stat label="Total length" id="profileTotalLength" />
                <Stat label="Average slope" id="profileAvgSlope" />
                <Stat label="Min elevation" id="profileMinElevation" />
                <Stat
                  label="Max elevation"
                  id="profileMaxElevation"
                  valueClass="text-map-accent-ink"
                />
                <Stat
                  label="Elevation gain"
                  id="profileElevationGain"
                  valueClass="text-map-success"
                />
                <Stat
                  label="Elevation loss"
                  id="profileElevationLoss"
                  valueClass="text-map-danger"
                />
              </div>

              <div
                id="profileCompareStatsSection"
                className="flex hidden flex-col gap-2 border-t border-map-line pt-3"
              >
                <p className="map-label">Comparison terrain</p>
                <div className="map-stat-grid">
                  <Stat label="Average slope" id="profileCompareAvgSlope" />
                  <Stat label="Min elevation" id="profileCompareMinElevation" />
                  <Stat
                    label="Max elevation"
                    id="profileCompareMaxElevation"
                    valueClass="text-map-accent-ink"
                  />
                  <Stat
                    label="Elevation gain"
                    id="profileCompareElevationGain"
                    valueClass="text-map-success"
                  />
                  <Stat
                    label="Elevation loss"
                    id="profileCompareElevationLoss"
                    valueClass="text-map-danger"
                    className="col-span-2"
                  />
                </div>
              </div>

              <div
                id="profileDeltaStatsSection"
                className="flex hidden flex-col gap-2 border-t border-map-line pt-3"
              >
                <p className="map-label">Difference (active − comparison)</p>
                <div className="map-stat-grid">
                  <Stat label="Average difference" id="profileDeltaAvg" className="col-span-2" />
                  <Stat label="Min difference" id="profileDeltaMin" />
                  <Stat label="Max difference" id="profileDeltaMax" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
