import { CircleCheck, X, type LucideIcon } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
} from "react";

/**
 * Small form and button components used by the map page (ports of the Blade components
 * x-button-close, x-button-primary, x-button-light, x-input-label, x-text-input, x-radio-card
 * and x-modal). Same markup and classes, so the vanilla scripts and globals.css keep working.
 */

/** Appends extra classes like Blade's $attributes->merge(['class' => ...]) (no tailwind-merge). */
function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/** x-button-close */
export function ButtonClose({
  iconClass = "text-xl",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { iconClass?: string }) {
  return (
    <button
      type="button"
      className={cn("map-icon-btn -mr-1 -mt-0.5", className)}
      aria-label="Close"
      {...props}
    >
      <X size="1em" className={iconClass} aria-hidden="true" />
    </button>
  );
}

const BUTTON_SIZES = {
  small: "text-sm px-2.5 py-1.5",
  normal: "text-base px-4 py-2",
  large: "text-lg px-6 py-3",
} as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: keyof typeof BUTTON_SIZES;
  variant?: "solid" | "outline" | "transparent";
  [dataAttribute: `data-${string}`]: string | undefined;
};

const PRIMARY_VARIANTS = {
  solid:
    "bg-primary text-white border-transparent shadow-md enabled:hover:bg-primary/90 enabled:hover:shadow-lg",
  outline: "bg-transparent text-primary border-primary border-[1.5px] enabled:hover:bg-primary/5",
  transparent: "bg-transparent text-primary enabled:hover:bg-primary/10",
} as const;

/** x-button-primary (button form; the map page has no link variant). */
export function ButtonPrimary({
  size = "normal",
  variant = "solid",
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = `${PRIMARY_VARIANTS[variant]} inline-flex items-center justify-center gap-2 rounded-[0.625rem] ${BUTTON_SIZES[size]} text-center font-semibold tracking-wide transition-all duration-250 hover:-translate-y-[1px] active:translate-y-0 active:shadow-none focus:outline-none focus:ring-[3px] focus:ring-primary/20 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0`;
  return (
    <button type={type} className={cn(classes, className)} {...props}>
      {children}
    </button>
  );
}

const LIGHT_VARIANTS = {
  solid:
    "bg-neutral text-foreground border-border border-[1.5px] shadow-sm enabled:hover:bg-muted/50 enabled:hover:border-primary/30",
  outline:
    "bg-transparent text-foreground border-border border-[1.5px] enabled:hover:bg-neutral/50",
  transparent: "bg-transparent text-foreground enabled:hover:bg-foreground/10",
} as const;

/** x-button-light (button form). */
export function ButtonLight({
  size = "normal",
  variant = "solid",
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  const classes = `${LIGHT_VARIANTS[variant]} inline-flex items-center justify-center gap-2 rounded-[0.625rem] ${BUTTON_SIZES[size]} text-center font-semibold tracking-wide transition-all duration-250 hover:-translate-y-[1px] active:translate-y-0 active:shadow-none focus:outline-none focus:ring-[3px] focus:ring-primary/10 disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0`;
  return (
    <button type={type} className={cn(classes, className)} {...props}>
      {children}
    </button>
  );
}

/** x-input-label */
export function InputLabel({
  value,
  icon,
  className,
  children,
  ...props
}: LabelHTMLAttributes<HTMLLabelElement> & { value?: ReactNode; icon?: LucideIcon }) {
  const Icon = icon;
  return (
    <label
      className={cn("flex items-center gap-2 text-sm font-bold text-foreground mb-2", className)}
      {...props}
    >
      {Icon && <Icon size="1em" className="text-primary" aria-hidden="true" />}
      <span>{value ?? children}</span>
    </label>
  );
}

const INPUT_SIZES = {
  small: "text-sm px-2 py-1.5",
  normal: "text-[0.85rem] px-3 py-2",
  large: "text-lg px-4 py-3",
} as const;

/** x-text-input */
export function TextInput({
  icon,
  inputSize = "normal",
  isError = false,
  className,
  children,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  icon?: LucideIcon;
  inputSize?: keyof typeof INPUT_SIZES;
  isError?: boolean;
}) {
  const Icon = icon;
  return (
    <div className="relative flex items-center">
      {Icon && (
        <span className="pointer-events-none absolute left-3.5 z-10 flex items-center text-[1rem] text-base-content-muted">
          <Icon size="1em" aria-hidden="true" />
        </span>
      )}

      <input
        className={cn(
          `w-full rounded-[0.625rem] border-[1.5px] ${isError ? "border-red-500" : "border-border"} bg-input ${INPUT_SIZES[inputSize]} ${icon ? "pl-10" : ""} text-foreground outline-none transition-all duration-200 placeholder:font-normal placeholder:text-[#a0aec0] focus:border-primary focus:ring-[3px] focus:ring-primary/10`,
          className,
        )}
        {...props}
      />

      {children}
    </div>
  );
}

/** x-radio-card. Controlled when `onChange` is given, otherwise `checked` is the initial state. */
export function RadioCard({
  name,
  value,
  icon: Icon,
  title,
  description,
  checked = false,
  onChange,
}: {
  name: string;
  value: string;
  icon: LucideIcon;
  title: string;
  description: string;
  checked?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <label className="group relative flex cursor-pointer items-center gap-3 rounded-xl border-2 border-border p-3 transition-all hover:border-primary/30 hover:bg-primary/2 has-checked:border-primary has-checked:bg-primary/5">
      <input
        type="radio"
        name={name}
        value={value}
        className="hidden"
        {...(onChange
          ? { checked, onChange: () => onChange(value) }
          : { defaultChecked: checked })}
      />
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-has-checked:bg-primary group-has-checked:text-white">
        <Icon size="1em" className="text-xl" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-foreground truncate">{title}</p>
        <p className="text-[10px] text-foreground/60 truncate">{description}</p>
      </div>
      <CircleCheck
        size="1em"
        className="absolute right-2 top-2 scale-0 text-primary transition-transform group-has-checked:scale-100"
        aria-hidden="true"
      />
    </label>
  );
}

const MODAL_WIDTHS = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
} as const;

/** x-modal: opened and closed by src/lib/map/ui-interactions.js ([data-modal], [data-modal-open], [data-modal-close]). */
export function Modal({
  name,
  id,
  show = false,
  maxWidth = "2xl",
  focusable = false,
  children,
}: {
  name: string;
  id?: string;
  show?: boolean;
  maxWidth?: keyof typeof MODAL_WIDTHS;
  focusable?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      className="fixed inset-0 z-100 flex items-center justify-center px-4 py-6 sm:px-0"
      data-modal={name}
      data-modal-show={show ? "true" : "false"}
      {...(focusable ? { "data-modal-focusable": "" } : {})}
      role="dialog"
      aria-modal="true"
      aria-hidden={show ? "false" : "true"}
      tabIndex={-1}
      style={{ display: show ? "flex" : "none" }}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" data-modal-close=""></div>

      {/* Modal Content */}
      <div
        className={`${MODAL_WIDTHS[maxWidth]} bg-neutral border-border relative z-50 max-h-[calc(100dvh-3rem)] w-full transform overflow-y-auto rounded-2xl border shadow-2xl transition-all`}
        data-modal-content=""
      >
        {children}
      </div>
    </div>
  );
}
