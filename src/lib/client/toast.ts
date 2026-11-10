/**
 * Toast notifications (port of the MyZkToast component). Renders into #zk-toast-container, which
 * the root layout provides. Also exposed as `window.MyZkToast` for the vanilla map scripts.
 */
export type ToastType = "success" | "error" | "warning" | "info";

const ICONS: Record<ToastType, string> = {
  success: `<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5Zm3.707 8.207-4 4a1 1 0 0 1-1.414 0l-2-2a1 1 0 0 1 1.414-1.414L9 10.586l3.293-3.293a1 1 0 0 1 1.414 1.414Z"/></svg>`,
  error: `<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 .5a9.5 9.5 0 1 0 9.5 9.5A9.51 9.51 0 0 0 10 .5ZM8.293 8.293a1 1 0 0 1 1.414 0L10 9.586l1.293-1.293a1 1 0 1 1 1.414 1.414L11.414 11l1.293 1.293a1 1 0 0 1-1.414 1.414L10 12.414l-1.293 1.293a1 1 0 1 1-1.414-1.414L8.586 11 7.293 9.707a1 1 0 0 1 0-1.414Z"/></svg>`,
  warning: `<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path d="M9.293 3.293a1 1 0 0 1 1.414 0l6 6a1 1 0 0 1-1.414 1.414L11 6.414V15a1 1 0 1 1-2 0V6.414L4.707 10.707A1 1 0 0 1 3.293 9.293l6-6Z"/></svg>`,
  info: `<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20"><path d="M10 2a8 8 0 1 1-8 8 8 8 0 0 1 8-8Zm0 3a1 1 0 0 0-1 1v4a1 1 0 1 0 2 0V6a1 1 0 0 0-1-1Zm0 10a1.2 1.2 0 1 0 0-2.4A1.2 1.2 0 0 0 10 15Z"/></svg>`,
};

const BG: Record<ToastType, string> = {
  success: "bg-success/20 text-success",
  error: "bg-error/20 text-error",
  warning: "bg-warning/20 text-warning",
  info: "bg-info/20 text-info",
};

function escape(message: unknown): string {
  return String(message ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export class MyZkToast {
  static maxToasts = 2;
  static toasts: string[] = [];
  static duration = 5000;
  private static counter = 0;

  /** `customIcon` is trusted HTML (callers pass static SVG markup only). */
  static show(message: unknown, type: ToastType = "info", customIcon: string | null = null): void {
    if (typeof document === "undefined") return;
    if (this.toasts.length >= this.maxToasts) this.removeOldest();

    const container = document.getElementById("zk-toast-container");
    if (!container) return;

    const id = `toast-${Date.now()}-${++this.counter}`;
    this.toasts.push(id);
    container.insertAdjacentHTML("beforeend", this.template(id, message, type, customIcon));

    const toast = document.getElementById(id);
    if (!toast) return;
    toast.querySelector<HTMLButtonElement>("[data-toast-close]")?.addEventListener("click", () => this.close(id));

    setTimeout(() => toast.classList.add("translate-x-0", "opacity-100"), 10);
    const progressBar = toast.querySelector<HTMLElement>(".zk-progress-bar");
    if (progressBar) setTimeout(() => (progressBar.style.width = "0%"), 50);
    setTimeout(() => this.close(id), this.duration);
  }

  static removeOldest(): void {
    const oldest = this.toasts.shift();
    if (oldest) this.close(oldest);
  }

  static close(id: string): void {
    this.toasts = this.toasts.filter((toastId) => toastId !== id);
    const toast = document.getElementById(id);
    if (toast) {
      toast.classList.add("translate-x-5", "opacity-0");
      setTimeout(() => toast.remove(), 300);
    }
  }

  private static template(id: string, message: unknown, type: ToastType, customIcon: string | null): string {
    return `
      <div id="${id}" role="alert" class="toast relative flex max-w-xs items-center rounded-lg bg-background p-4 text-foreground shadow-md transition-all duration-300 transform translate-x-5 opacity-0">
        <div class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${BG[type] ?? "bg-primary/10 text-primary"}">
          ${customIcon || ICONS[type] || ""}
        </div>
        <div class="ml-3 text-sm font-normal me-2">${escape(message)}</div>
        <button type="button" data-toast-close aria-label="Close" class="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg bg-background p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-900 focus:ring-2 focus:ring-gray-300">
          <svg class="h-3 w-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 14 14">
            <path stroke-linecap="round" stroke-linejoin="round" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6"></path>
          </svg>
        </button>
        <div class="absolute bottom-0 left-0 h-1 w-full bg-gray-200 overflow-hidden">
          <div class="zk-progress-bar h-full bg-primary transition-all duration-[5000ms] ease-linear w-full"></div>
        </div>
      </div>`;
  }

  static success(message: unknown, customIcon: string | null = null) {
    this.show(message, "success", customIcon);
  }

  static error(message: unknown, customIcon: string | null = null) {
    this.show(message, "error", customIcon);
  }

  static warning(message: unknown, customIcon: string | null = null) {
    this.show(message, "warning", customIcon);
  }

  static info(message: unknown, customIcon: string | null = null) {
    this.show(message, "info", customIcon);
  }
}

/** React-friendly alias: `toast.success("Saved")`. */
export const toast = {
  success: (message: unknown) => MyZkToast.success(message),
  error: (message: unknown) => MyZkToast.error(message),
  warning: (message: unknown) => MyZkToast.warning(message),
  info: (message: unknown) => MyZkToast.info(message),
};
