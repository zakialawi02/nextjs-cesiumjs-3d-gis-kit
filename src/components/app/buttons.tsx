import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Buttons (port of components/button-primary, button-light and button-success). With `href` they
 * render a Next.js link, otherwise a <button>.
 */
type Size = "small" | "normal" | "large";
type Variant = "solid" | "outline" | "transparent";

const SIZES: Record<Size, string> = {
  small: "text-sm px-2.5 py-1.5",
  normal: "text-base px-4 py-2",
  large: "text-lg px-6 py-3",
};

const BASE =
  "inline-flex items-center justify-center gap-2 rounded-[0.625rem] text-center font-semibold tracking-wide transition-all duration-250 hover:-translate-y-[1px] active:translate-y-0 active:shadow-none focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:translate-y-0";

type Tone = { base: string; hoverLink: string; hoverButton: string };

const PRIMARY: Record<Variant, Tone> = {
  solid: {
    base: "bg-primary text-white border-transparent shadow-md",
    hoverLink: "hover:bg-primary/90 hover:shadow-lg",
    hoverButton: "enabled:hover:bg-primary/90 enabled:hover:shadow-lg",
  },
  outline: {
    base: "bg-transparent text-primary border-primary border-[1.5px]",
    hoverLink: "hover:bg-primary/5",
    hoverButton: "enabled:hover:bg-primary/5",
  },
  transparent: {
    base: "bg-transparent text-primary",
    hoverLink: "hover:bg-primary/10",
    hoverButton: "enabled:hover:bg-primary/10",
  },
};

const LIGHT: Record<Variant, Tone> = {
  solid: {
    base: "bg-neutral text-foreground border-border border-[1.5px] shadow-sm",
    hoverLink: "hover:bg-muted/50 hover:border-primary/30",
    hoverButton: "enabled:hover:bg-muted/50 enabled:hover:border-primary/30",
  },
  outline: {
    base: "bg-transparent text-foreground border-border border-[1.5px]",
    hoverLink: "hover:bg-neutral/50",
    hoverButton: "enabled:hover:bg-neutral/50",
  },
  transparent: {
    base: "bg-transparent text-foreground",
    hoverLink: "hover:bg-foreground/10",
    hoverButton: "enabled:hover:bg-foreground/10",
  },
};

type ButtonProps = {
  href?: string;
  size?: Size;
  variant?: Variant;
  className?: string;
  children?: ReactNode;
} & Omit<ComponentProps<"button">, "className" | "children"> &
  Pick<ComponentProps<"a">, "target" | "rel">;

function renderButton(tones: Record<Variant, Tone>, ring: string, props: ButtonProps) {
  const { href, size = "normal", variant = "solid", className, children, type = "button", target, rel, ...rest } = props;
  const tone = tones[variant];
  const classes = cn(tone.base, href ? tone.hoverLink : tone.hoverButton, BASE, SIZES[size], ring, className);

  if (href) {
    return (
      <Link href={href} className={classes} target={target} rel={rel} title={rest.title} aria-label={rest["aria-label"]}>
        {children}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}

export function ButtonPrimary(props: ButtonProps) {
  return renderButton(PRIMARY, "focus:ring-[3px] focus:ring-primary/20", props);
}

export function ButtonLight(props: ButtonProps) {
  return renderButton(LIGHT, "focus:ring-[3px] focus:ring-primary/10", props);
}
