"use client";

import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/lib/client/theme";

import { cn } from "@/lib/utils";

type ThemeToggleProps = {
  className?: string;
  /** Tooltip text for map controls that use the `data-tooltip` style instead of `title`. */
  tooltip?: string;
};

/**
 * Light/dark switch (port of components/theme-toggle.blade.php). The choice is stored in
 * localStorage under "hs_theme", the same key the Laravel app used (src/lib/client/theme.ts).
 */
export function ThemeToggle({ className, tooltip }: ThemeToggleProps) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className={cn(
        "inline-flex size-9 items-center justify-center rounded-full text-foreground/80 transition hover:bg-muted hover:text-primary",
        className,
      )}
      aria-label="Toggle dark mode"
      {...(tooltip ? { "data-tooltip": tooltip } : { title: "Toggle dark mode" })}
    >
      <Moon className="size-[1.125rem] dark:hidden" aria-hidden="true" />
      <Sun className="hidden size-[1.125rem] dark:inline" aria-hidden="true" />
    </button>
  );
}
