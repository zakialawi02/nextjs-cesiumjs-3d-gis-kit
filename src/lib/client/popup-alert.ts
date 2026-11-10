/**
 * Confirmation popup (port of the ZkPopAlert component). Created lazily on first use and exposed as
 * `window.ZkPopAlert` for the vanilla map scripts. React code can use `confirmPopup()` instead.
 */
import { iconSvg } from "@/lib/icons";

export type PopupOptions = {
  message: string;
  /** Trusted HTML (static SVG markup only). */
  icon?: string;
  confirmText?: string;
  cancelText?: string;
  confirmClass?: string;
  cancelClass?: string;
  popupClass?: string;
  backdropClass?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
};

const DEFAULT_CONFIRM_CLASS =
  "text-sm px-4 py-2 text-white bg-error rounded-lg hover:bg-error/80 focus:outline-none focus:ring-4 focus:ring-error";
const DEFAULT_CANCEL_CLASS =
  "ms-3 text-sm px-4 py-2 text-gray-900 bg-white border border-gray-200 rounded-lg hover:bg-gray-100 focus:z-10 focus:outline-none focus:ring-4 focus:ring-gray-100";

export class PopupAlert {
  private popup!: HTMLDivElement;
  private backdrop!: HTMLDivElement;
  private content!: HTMLDivElement;
  private onCancel: (() => void) | undefined;

  constructor() {
    this.create();
  }

  private create() {
    this.popup = document.createElement("div");
    this.popup.id = "zk-popup-modal";
    this.popup.className = "fixed inset-0 z-[300] hidden flex items-center justify-center";
    this.popup.setAttribute("role", "dialog");
    this.popup.setAttribute("aria-modal", "true");

    this.backdrop = document.createElement("div");
    this.backdrop.className = "absolute inset-0 bg-gray-800/50";

    this.content = document.createElement("div");
    this.content.className =
      "relative z-10 max-w-md w-full p-4 rounded-lg shadow-sm bg-background text-foreground border border-border";
    this.content.innerHTML = `
      <button data-popup-close class="absolute end-2.5 top-3 ms-auto inline-flex h-8 w-8 items-center justify-center rounded-lg bg-transparent text-gray-400 hover:bg-gray-200 hover:text-gray-900" type="button">
        <svg class="h-3 w-3" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14">
          <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m1 1 6 6m0 0 6 6M7 7l6-6M7 7l-6 6" />
        </svg>
        <span class="sr-only">Close modal</span>
      </button>
      <div class="p-4 text-center md:p-5">
        <div data-popup-icon class="mx-auto mb-4"></div>
        <h3 data-popup-message class="mb-5 text-lg font-normal"></h3>
        <button type="button" data-popup-confirm class="text-sm px-4 py-2 text-center rounded-lg">Yes</button>
        <button type="button" data-popup-cancel class="ms-3 text-sm px-4 py-2 rounded-lg">No</button>
      </div>`;

    this.popup.append(this.backdrop, this.content);
    document.body.appendChild(this.popup);

    const cancel = () => {
      this.onCancel?.();
      this.hide();
    };
    this.content.querySelector("[data-popup-close]")?.addEventListener("click", cancel);
    this.content.querySelector("[data-popup-cancel]")?.addEventListener("click", cancel);
    this.backdrop.addEventListener("click", cancel);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.popup.classList.contains("hidden")) cancel();
    });
  }

  show(options: PopupOptions) {
    if (!this.popup.isConnected) document.body.appendChild(this.popup);

    this.content.querySelector("[data-popup-message]")!.textContent = options.message;
    this.content.querySelector("[data-popup-icon]")!.innerHTML = options.icon ?? "";

    const confirmButton = this.content.querySelector<HTMLButtonElement>("[data-popup-confirm]")!;
    confirmButton.textContent = options.confirmText || "Yes";
    confirmButton.className = options.confirmClass || DEFAULT_CONFIRM_CLASS;

    const cancelButton = this.content.querySelector<HTMLButtonElement>("[data-popup-cancel]")!;
    cancelButton.textContent = options.cancelText || "No";
    cancelButton.className = options.cancelClass || DEFAULT_CANCEL_CLASS;

    this.content.className = `relative z-10 max-w-md w-full p-4 rounded-lg shadow-sm ${options.popupClass || "bg-background text-foreground border border-border"}`;
    this.backdrop.className = `absolute inset-0 ${options.backdropClass || "bg-gray-800/50"}`;

    this.onCancel = options.onCancel;
    confirmButton.onclick = () => {
      this.onCancel = undefined;
      options.onConfirm?.();
      this.hide();
    };

    this.popup.classList.remove("hidden");
    confirmButton.focus();
  }

  hide() {
    this.popup.classList.add("hidden");
  }
}

let instance: PopupAlert | null = null;

export function getPopupAlert(): PopupAlert {
  instance ??= new PopupAlert();
  return instance;
}

/** Promise-based confirmation: resolves true when the user confirms. */
export function confirmPopup(options: Omit<PopupOptions, "onConfirm" | "onCancel">): Promise<boolean> {
  return new Promise((resolve) => {
    getPopupAlert().show({
      ...options,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/** Warning icon used by delete confirmations. */
export const DANGER_ICON = iconSvg("circle-alert", { className: "mx-auto text-5xl text-error" });
