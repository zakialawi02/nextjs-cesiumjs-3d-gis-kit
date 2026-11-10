import type { LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Form primitives (port of components/text-input, input-label, input-error, auth-session-status).
 * Plain components without hooks, so both server pages and client forms can use them. Icons are
 * Lucide components (e.g. `icon={Search}`), so pass them from the module that renders the field: a
 * Server Component cannot hand one to a Client Component such as PasswordInput.
 */

const INPUT_SIZES = {
  small: "text-sm px-2 py-1.5",
  normal: "text-[0.85rem] px-3 py-2",
  large: "text-lg px-4 py-3",
} as const;

type TextInputProps = Omit<ComponentProps<"input">, "size"> & {
  /** Lucide icon shown inside the field on the left. */
  icon?: LucideIcon;
  size?: keyof typeof INPUT_SIZES;
  isError?: boolean;
  /** Extra elements inside the field wrapper (e.g. a show-password button). */
  children?: ReactNode;
};

export function TextInput({ icon: Icon, size = "normal", isError = false, className, children, ...props }: TextInputProps) {
  return (
    <div className="relative flex items-center">
      {Icon ? (
        <span className="pointer-events-none absolute left-3.5 z-10 flex items-center text-base-content-muted">
          <Icon className="size-4" aria-hidden="true" />
        </span>
      ) : null}

      <input
        className={cn(
          "w-full rounded-[0.625rem] border-[1.5px] bg-input text-foreground outline-none transition-all duration-200 placeholder:font-normal placeholder:text-[#a0aec0] focus:border-primary focus:ring-[3px] focus:ring-primary/10",
          isError ? "border-red-500" : "border-border",
          INPUT_SIZES[size],
          Icon && "pl-10",
          className,
        )}
        aria-invalid={isError || undefined}
        {...props}
      />

      {children}
    </div>
  );
}

export function InputLabel({
  value,
  icon: Icon,
  className,
  children,
  ...props
}: ComponentProps<"label"> & { value?: ReactNode; icon?: LucideIcon }) {
  return (
    <label className={cn("mb-2 flex items-center gap-2 text-sm font-bold text-foreground", className)} {...props}>
      {Icon ? <Icon className="size-3.5 shrink-0 text-primary" aria-hidden="true" /> : null}
      <span>{value ?? children}</span>
    </label>
  );
}

export function InputError({ messages, className, id }: { messages?: string[] | string | null; className?: string; id?: string }) {
  const list = messages ? (Array.isArray(messages) ? messages : [messages]) : [];
  if (list.length === 0) return null;

  return (
    <ul className={cn("space-y-1 text-sm text-error", className)} id={id} role="alert">
      {list.map((message, index) => (
        <li key={`${index}-${message}`}>{message}</li>
      ))}
    </ul>
  );
}

export function AuthSessionStatus({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return null;
  return (
    <div className={cn("text-sm font-medium text-success", className)} role="status">
      {status}
    </div>
  );
}

/** The <select> style used by the dashboard filters and modals. */
export function SelectInput({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "rounded-[0.625rem] border-[1.5px] border-border bg-input px-3 py-2 text-sm text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
