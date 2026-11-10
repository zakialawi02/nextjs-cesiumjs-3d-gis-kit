import { CircleAlert, Inbox, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/** Port of components/empty-state.blade.php (messages are plain text here, never HTML). */
export function EmptyState({
  message,
  subtitle,
  type = "empty",
  icon: Icon,
  iconClass = "size-4.5",
  containerClass = "py-4",
  id,
}: {
  message: string;
  subtitle?: string;
  type?: "empty" | "error";
  /** Lucide icon; without one, an inbox (or a warning for errors) in a small circle. */
  icon?: LucideIcon;
  /** Size classes of the icon (e.g. "size-6"). */
  iconClass?: string;
  containerClass?: string;
  id?: string;
}) {
  return (
    <div id={id} className={cn(containerClass, "flex flex-col items-center justify-center gap-1 text-center")}>
      {type === "error" ? (
        <div className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-error/10 text-error">
          {Icon ? <Icon className={iconClass} aria-hidden="true" /> : <CircleAlert className={iconClass} aria-hidden="true" />}
        </div>
      ) : Icon ? (
        <Icon className={cn(iconClass, "mb-2 block text-foreground/20")} aria-hidden="true" />
      ) : (
        <div className="mb-1 flex h-8 w-8 items-center justify-center rounded-full bg-foreground/5 text-foreground/40">
          <Inbox className={iconClass} aria-hidden="true" />
        </div>
      )}

      <p className={cn("text-[11px]", type === "error" ? "font-medium text-error" : "text-foreground/50")}>{message}</p>

      {subtitle ? <p className="mt-0.5 text-[10px] text-foreground/30">{subtitle}</p> : null}
    </div>
  );
}
