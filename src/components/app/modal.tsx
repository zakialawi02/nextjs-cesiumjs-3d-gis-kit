"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Accessible modal (port of components/modal.blade.php) on Radix Dialog: focus trap, Escape and
 * backdrop click close it, scroll is locked while open. Put a <ModalTitle> somewhere inside.
 */
const MAX_WIDTHS = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
} as const;

export function Modal({
  open,
  onOpenChange,
  maxWidth = "2xl",
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  maxWidth?: keyof typeof MAX_WIDTHS;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 px-4 py-6 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:px-0">
          <Dialog.Content
            aria-describedby={undefined}
            className={cn(
              MAX_WIDTHS[maxWidth],
              "relative max-h-[calc(100dvh-3rem)] w-full transform overflow-y-auto rounded-2xl border border-border bg-neutral shadow-2xl outline-none",
              "duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-bottom-4",
              className,
            )}
          >
            {children}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ModalTitle({ className, ...props }: ComponentProps<typeof Dialog.Title>) {
  return <Dialog.Title className={cn("text-base font-bold text-foreground", className)} {...props} />;
}

/** The "×" close button used in the modal headers. */
export function ModalCloseButton({ className }: { className?: string }) {
  return (
    <Dialog.Close asChild>
      <button type="button" className={cn("text-foreground/60 hover:text-error", className)} aria-label="Close">
        <X className="size-5" aria-hidden="true" />
      </button>
    </Dialog.Close>
  );
}
