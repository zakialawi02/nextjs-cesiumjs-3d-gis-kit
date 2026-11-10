/**
 * Lucide icons as SVG markup for code that builds HTML strings or swaps icons imperatively
 * (the vanilla map scripts in src/lib/map, the popup alert). React components use `lucide-react`
 * directly instead.
 *
 * Icons are sized `1em` so the surrounding `text-*` classes keep controlling their size (as the
 * Remix Icon font did), and carry `data-icon="<name>"` so CSS and scripts can target a specific
 * icon (e.g. `.map-layer-toggle [data-icon="eye"]`).
 *
 * Only icons listed in ICONS are bundled; add new ones there (kebab-case name → lucide export).
 */
import {
  Archive,
  ChartScatter,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Crosshair,
  Eye,
  EyeOff,
  File,
  History,
  Image,
  Layers,
  LoaderCircle,
  LocateFixed,
  MapPin,
  Mountain,
  Pause,
  Play,
  Search,
  Shapes,
  Tag,
  X,
  type IconNode,
} from "lucide";

export const ICONS = {
  archive: Archive,
  "chart-scatter": ChartScatter,
  "chevron-right": ChevronRight,
  "circle-alert": CircleAlert,
  "circle-check": CircleCheck,
  crosshair: Crosshair,
  eye: Eye,
  "eye-off": EyeOff,
  file: File,
  history: History,
  image: Image,
  layers: Layers,
  "loader-circle": LoaderCircle,
  "locate-fixed": LocateFixed,
  "map-pin": MapPin,
  mountain: Mountain,
  pause: Pause,
  play: Play,
  search: Search,
  shapes: Shapes,
  tag: Tag,
  x: X,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

export type IconOptions = {
  /** Extra classes, e.g. "text-[15px] text-primary animate-spin". */
  className?: string;
  strokeWidth?: number;
  /** Accessible label; without it the icon is aria-hidden. */
  label?: string;
};

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function renderNode(node: IconNode): string {
  return node
    .map(([tag, attrs]) => {
      const attributes = Object.entries(attrs)
        .filter(([key]) => key !== "key")
        .map(([key, value]) => `${key}="${escapeAttribute(String(value))}"`)
        .join(" ");
      return `<${tag} ${attributes}/>`;
    })
    .join("");
}

export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

/** SVG markup for a registered Lucide icon. */
export function iconSvg(name: IconName, options: IconOptions = {}): string {
  const { className = "", strokeWidth = 2, label } = options;
  const a11y = label ? `role="img" aria-label="${escapeAttribute(label)}"` : `aria-hidden="true"`;
  const classes = `lucide-icon lucide-${name} ${className}`.trim();
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" ` +
    `class="${escapeAttribute(classes)}" data-icon="${name}" ${a11y}>${renderNode(ICONS[name])}</svg>`
  );
}

/**
 * A registered icon as a standalone `data:` SVG image with explicit colours (no currentColor), for
 * canvas-drawn images such as Cesium billboards.
 */
export function iconDataUri(
  name: IconName,
  {
    size = 24,
    stroke = "#ffffff",
    fill = "none",
    strokeWidth = 2,
  }: { size?: number; stroke?: string; fill?: string; strokeWidth?: number } = {},
): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" ` +
    `fill="${escapeAttribute(fill)}" stroke="${escapeAttribute(stroke)}" stroke-width="${strokeWidth}" ` +
    `stroke-linecap="round" stroke-linejoin="round">${renderNode(ICONS[name])}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** A detached SVG element for a registered Lucide icon (browser only). */
export function iconElement(name: IconName, options: IconOptions = {}): SVGSVGElement {
  const template = document.createElement("template");
  template.innerHTML = iconSvg(name, options);
  return template.content.firstElementChild as SVGSVGElement;
}

/**
 * Replaces an icon element in place (the imperative equivalent of swapping `ri-*` classes) and
 * returns the new element. Use it where scripts used to change an `<i>`'s icon class.
 */
export function setIcon(target: Element, name: IconName, options: IconOptions = {}): SVGSVGElement {
  const replacement = iconElement(name, options);
  target.replaceWith(replacement);
  return replacement;
}

/** The registered icon name of an icon element rendered by this module (or lucide-react with data-icon). */
export function iconNameOf(element: Element | null | undefined): string | null {
  return element?.getAttribute("data-icon") ?? null;
}
