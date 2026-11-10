/* eslint-disable @next/next/no-img-element -- static Cesium navigation SVGs from public/cesium */

import {
  ChartColumn,
  CircleQuestionMark,
  Hand,
  Mouse,
  MountainSnow,
  Orbit,
  Pipette,
  Ruler,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

type HelpItem = { img: string; color: string; title: string; lines: string[] };

const MOUSE: HelpItem[] = [
  { img: "MouseLeft.svg", color: "#66ccff", title: "Pan view", lines: ["Left click and drag"] },
  {
    img: "MouseRight.svg",
    color: "#65fd00",
    title: "Zoom",
    lines: ["Right click and drag, or scroll the wheel"],
  },
  {
    img: "MouseMiddle.svg",
    color: "#ffd800",
    title: "Rotate view",
    lines: ["Middle click and drag, or Ctrl + left/right click and drag"],
  },
];

const TOUCH: HelpItem[] = [
  { img: "TouchDrag.svg", color: "#66ccff", title: "Pan view", lines: ["Drag with one finger"] },
  { img: "TouchZoom.svg", color: "#65fd00", title: "Zoom", lines: ["Pinch with two fingers"] },
  {
    img: "TouchTilt.svg",
    color: "#ffd800",
    title: "Tilt view",
    lines: ["Drag two fingers in the same direction"],
  },
  {
    img: "TouchRotate.svg",
    color: "#d800d8",
    title: "Rotate view",
    lines: ["Drag two fingers in opposite directions"],
  },
];

const TOOLS: Array<{ icon: LucideIcon; title: string; label: string }> = [
  {
    icon: Ruler,
    title: "Measure",
    label: "Distance, area and circle. Press Done or double-click to finish a shape.",
  },
  {
    icon: ChartColumn,
    title: "Vol / Profile",
    label: "Cut & fill volume and elevation profiles. Needs an active terrain layer.",
  },
  {
    icon: Pipette,
    title: "Pick coordinates",
    label: "Shows latitude, longitude and elevation of a clicked point.",
  },
  {
    icon: Orbit,
    title: "Pivot camera",
    label: "Orbits the camera around a point you pick.",
  },
  {
    icon: MountainSnow,
    title: "Depth test against terrain",
    label: "Hides vector features behind hills or below the terrain surface. Switch it in the account menu.",
  },
];

const SHORTCUTS = [
  { keys: ["L"], label: "Layers panel" },
  { keys: ["D"], label: "Data panel (admin)" },
  { keys: ["Esc"], label: "Close panels and popovers" },
];

function HelpItems({ items, width, height }: { items: HelpItem[]; width: number; height: number }) {
  return items.map((item) => (
    <div key={item.img} className="map-help-item">
      <span className="map-help-tile">
        <img
          src={`/cesium/Widgets/Images/NavigationHelp/${item.img}`}
          alt=""
          width={width}
          height={height}
        />
      </span>
      <div className="min-w-0">
        <p className="map-help-title">
          <span
            className="map-help-swatch"
            style={{ "--swatch": item.color } as CSSProperties}
          ></span>
          {item.title}
        </p>
        {item.lines.map((line) => (
          <p key={line} className="map-help-desc">
            {line}
          </p>
        ))}
      </div>
    </div>
  ));
}

/** Map help popover (toggled by #helpBtn in src/lib/map/cesium-map.js). */
export function HelpPanel() {
  return (
    <div
      id="cesiumHelpPanel"
      className="map-card map-card--help map-sheet hidden"
      role="dialog"
      aria-labelledby="cesiumHelpTitle"
    >
      <header className="map-card-head">
        <span className="map-card-icon" aria-hidden="true">
          <CircleQuestionMark size="1em" />
        </span>
        <h3 id="cesiumHelpTitle" className="map-card-title">
          Map help
        </h3>
        <button
          type="button"
          id="closeHelpPanelBtn"
          className="map-icon-btn"
          aria-label="Close help"
        >
          <X size="1em" aria-hidden="true" />
        </button>
      </header>

      <div className="flex-none px-3 pb-2">
        <div className="map-segmented" role="tablist" aria-label="Help topics">
          <button
            type="button"
            role="tab"
            id="helpMouseBtn"
            aria-controls="helpMouseContent"
            aria-selected="true"
            className="map-segment"
          >
            <Mouse size="1em" aria-hidden="true" />
            Mouse
          </button>
          <button
            type="button"
            role="tab"
            id="helpTouchBtn"
            aria-controls="helpTouchContent"
            aria-selected="false"
            className="map-segment"
          >
            <Hand size="1em" aria-hidden="true" />
            Touch
          </button>
          <button
            type="button"
            role="tab"
            id="helpToolsBtn"
            aria-controls="helpToolsContent"
            aria-selected="false"
            className="map-segment"
          >
            <Wrench size="1em" aria-hidden="true" />
            Tools
          </button>
        </div>
      </div>

      <div
        id="helpMouseContent"
        role="tabpanel"
        aria-labelledby="helpMouseBtn"
        className="map-card-body flex flex-col gap-1"
      >
        <HelpItems items={MOUSE} width={40} height={40} />
      </div>

      <div
        id="helpTouchContent"
        role="tabpanel"
        aria-labelledby="helpTouchBtn"
        className="map-card-body flex hidden flex-col gap-1"
      >
        <HelpItems items={TOUCH} width={48} height={34} />
      </div>

      <div
        id="helpToolsContent"
        role="tabpanel"
        aria-labelledby="helpToolsBtn"
        className="map-card-body flex hidden flex-col gap-3"
      >
        <ul className="flex flex-col gap-1">
          {TOOLS.map(({ icon: Icon, ...tool }) => (
            <li key={tool.title} className="map-help-item items-start">
              <span className="map-card-icon mt-0.5" aria-hidden="true">
                <Icon size="1em" />
              </span>
              <div className="min-w-0">
                <p className="map-help-title">{tool.title}</p>
                <p className="map-help-desc">{tool.label}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="border-t border-map-line pt-3">
          <p className="map-label mb-2">Keyboard</p>
          <ul className="flex flex-col gap-1.5">
            {SHORTCUTS.map((shortcut) => (
              <li
                key={shortcut.label}
                className="flex items-center justify-between gap-3 text-xs text-map-muted"
              >
                <span>{shortcut.label}</span>
                <span className="flex gap-1">
                  {shortcut.keys.map((key) => (
                    <kbd key={key} className="map-kbd">
                      {key}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
