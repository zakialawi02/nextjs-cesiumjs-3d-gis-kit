/**
 * Vanilla UI behaviours (port of resources/js/ui-interactions.js): modals ([data-modal]),
 * accordions ([data-accordion]), tabs ([data-tabs]), dismissible messages, the theme switch and
 * the off-canvas sidebar.
 *
 * Unlike the Laravel version, every initializer returns a cleanup function that removes the
 * listeners it added, so the map page can be mounted and unmounted by React repeatedly.
 * The light/dark switch itself is handled by React (src/components/theme-toggle.tsx and
 * the map account menu); initializeThemeToggle() is kept for parity but the map page does not use it.
 */

function animate(element, keyframes, duration) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        return null;
    }

    return element.animate?.(keyframes, { duration, easing: "ease-out" });
}

/** Collects listeners so they can be removed together. */
function listenerBag() {
    const listeners = [];
    return {
        on(target, type, listener, options) {
            if (!target) return;
            target.addEventListener(type, listener, options);
            listeners.push([target, type, listener, options]);
        },
        cleanup() {
            listeners.forEach(([target, type, listener, options]) => target.removeEventListener(type, listener, options));
            listeners.length = 0;
        },
    };
}

export function initializeTabs(group) {
    const bag = listenerBag();
    const ownElements = (selector) => [...group.querySelectorAll(selector)]
        .filter(element => element.closest("[data-tabs]") === group);
    const buttons = ownElements("[data-tab]");
    const panels = ownElements("[data-tab-panel]");
    const activeClasses = group.dataset.tabActiveClass.split(/\s+/);
    const inactiveClasses = group.dataset.tabInactiveClass.split(/\s+/);

    const selectTab = (value, shouldAnimate = false) => {
        buttons.forEach(button => {
            const selected = button.dataset.tab === value;
            button.classList.remove(...activeClasses, ...inactiveClasses);
            button.classList.add(...(selected ? activeClasses : inactiveClasses));
            button.setAttribute("aria-pressed", String(selected));
        });

        panels.forEach(panel => {
            const selected = panel.dataset.tabPanel === value;
            panel.style.display = selected ? "" : "none";
            if (selected && shouldAnimate && group.hasAttribute("data-tab-animate")) {
                animate(panel, [
                    { opacity: 0, transform: "translateY(8px)" },
                    { opacity: 1, transform: "translateY(0)" },
                ], 300);
            }
        });
    };

    const query = group.dataset.tabQuery;
    const requestedTab = query ? new URL(window.location.href).searchParams.get(query) : null;
    const initialPanel = panels.find(panel => [
        panel.dataset.tabPanel,
        ...(panel.dataset.tabAliases || "").split(/\s+/),
    ].includes(requestedTab));
    selectTab(initialPanel?.dataset.tabPanel || group.dataset.tabs);

    buttons.forEach(button => bag.on(button, "click", () => {
        selectTab(button.dataset.tab, true);
        if (query) {
            const url = new URL(window.location.href);
            url.searchParams.set(query, button.dataset.tabQueryValue || button.dataset.tab);
            window.history.replaceState(null, "", url);
        }
    }));

    return bag.cleanup;
}

export function initializeModals(root = document) {
    const bag = listenerBag();
    const openModals = new Set();
    const controllers = new Map();
    let hadScrollLock = false;

    root.querySelectorAll("[data-modal]").forEach(modal => {
        let isOpen = false;
        let previousFocus = null;
        let closingAnimation = null;
        const content = modal.querySelector("[data-modal-content]");
        const focusables = () => [...modal.querySelectorAll(
            'a[href], button, input:not([type="hidden"]), textarea, select, summary, [tabindex]',
        )].filter(element => !element.matches(':disabled, [tabindex="-1"]') && element.getClientRects().length);

        const open = () => {
            if (isOpen) {
                return;
            }

            closingAnimation?.cancel();
            isOpen = true;
            previousFocus = document.activeElement;
            if (openModals.size === 0) {
                hadScrollLock = document.body.classList.contains("overflow-y-hidden");
            }
            openModals.add(modal);
            document.body.classList.add("overflow-y-hidden");
            modal.style.display = "flex";
            modal.setAttribute("aria-hidden", "false");
            animate(content, [
                { opacity: 0, transform: "translateY(16px) scale(0.95)" },
                { opacity: 1, transform: "translateY(0) scale(1)" },
            ], 300);
            (modal.hasAttribute("data-modal-focusable") ? focusables()[0] || modal : modal).focus();
            modal.dispatchEvent(new CustomEvent("modal:opened"));
        };

        const close = () => {
            if (!isOpen) {
                return;
            }

            isOpen = false;
            openModals.delete(modal);
            modal.setAttribute("aria-hidden", "true");
            if (openModals.size === 0 && !hadScrollLock) {
                document.body.classList.remove("overflow-y-hidden");
            }
            closingAnimation = animate(content, [
                { opacity: 1, transform: "translateY(0) scale(1)" },
                { opacity: 0, transform: "translateY(16px) scale(0.95)" },
            ], 200);
            const hide = () => {
                if (!isOpen) {
                    modal.style.display = "none";
                }
            };
            if (closingAnimation) {
                closingAnimation.finished.then(hide).catch(() => {});
            } else {
                hide();
            }
            if (previousFocus?.isConnected) {
                previousFocus.focus();
            }
            modal.dispatchEvent(new CustomEvent("modal:closed"));
        };

        bag.on(modal, "click", event => {
            if (event.target.closest("[data-modal-close]")?.closest("[data-modal]") === modal) {
                event.preventDefault();
                close();
            }
        });
        bag.on(modal, "close", event => {
            event.stopPropagation();
            close();
        });
        bag.on(modal, "keydown", event => {
            if (!isOpen || event.key !== "Tab") {
                return;
            }

            event.preventDefault();
            const elements = focusables();
            const index = elements.indexOf(document.activeElement);
            const nextIndex = event.shiftKey
                ? (index <= 0 ? elements.length - 1 : index - 1)
                : (index + 1) % elements.length;
            (elements[nextIndex] || modal).focus();
        });

        controllers.set(modal.dataset.modal, { open, close });
        if (modal.dataset.modalShow === "true") {
            open();
        }
    });

    bag.on(root, "click", event => {
        const trigger = event.target.closest("[data-modal-open]");
        if (trigger) {
            event.preventDefault();
            controllers.get(trigger.dataset.modalOpen)?.open();
        }
    });
    bag.on(window, "open-modal", event => controllers.get(event.detail)?.open());
    bag.on(window, "close-modal", event => controllers.get(event.detail)?.close());
    bag.on(window, "keydown", event => {
        if (event.key === "Escape" && openModals.size) {
            controllers.get([...openModals].at(-1).dataset.modal)?.close();
        }
    });

    return () => {
        bag.cleanup();
        // An open modal locked page scrolling; release it when the page goes away.
        if (openModals.size > 0 && !hadScrollLock) {
            document.body.classList.remove("overflow-y-hidden");
        }
        openModals.clear();
        controllers.clear();
    };
}

export function initializeDismissals(root = document) {
    const timers = [];
    root.querySelectorAll("[data-dismiss-after]").forEach(message => {
        timers.push(window.setTimeout(() => {
            const animation = animate(message, [{ opacity: 1 }, { opacity: 0 }], 150);
            const hide = () => { message.style.display = "none"; };
            if (animation) {
                animation.finished.then(hide).catch(() => {});
            } else {
                hide();
            }
        }, Number(message.dataset.dismissAfter)));
    });

    return () => timers.forEach(timer => window.clearTimeout(timer));
}

/**
 * Accordion groups rendered as `[data-accordion]` containers with a `[data-accordion-toggle]`
 * button and `[data-accordion-content]` panel. Uses event delegation so lists re-rendered
 * with innerHTML keep working without re-initialisation.
 */
export function initializeAccordions(root = document) {
    const bag = listenerBag();
    bag.on(root, "click", (event) => {
        const toggle = event.target.closest("[data-accordion-toggle]");
        if (!toggle) {
            return;
        }

        const accordion = toggle.closest("[data-accordion]");
        const content = accordion?.querySelector(":scope > [data-accordion-content]");
        if (!accordion || !content) {
            return;
        }

        const isOpen = accordion.classList.toggle("is-open");
        content.hidden = !isOpen;
        toggle.setAttribute("aria-expanded", String(isOpen));
    });

    return bag.cleanup;
}

/**
 * Light/dark theme switch persisted in localStorage ("hs_theme" key kept for compatibility).
 * Not used by the Next.js map page (src/lib/client/theme.ts owns the theme); kept for parity.
 */
export function initializeThemeToggle(root = document) {
    const bag = listenerBag();
    bag.on(root, "click", (event) => {
        if (!event.target.closest("[data-theme-toggle]")) {
            return;
        }

        const isDark = document.documentElement.classList.toggle("dark");
        try {
            localStorage.setItem("hs_theme", isDark ? "dark" : "light");
        } catch {
            // Storage may be unavailable (private mode); the toggle still works for this page.
        }
        window.dispatchEvent(new CustomEvent("theme-changed", { detail: { dark: isDark } }));
    });

    return bag.cleanup;
}

/**
 * Off-canvas dashboard sidebar (below the lg breakpoint).
 */
export function initializeSidebar(root = document) {
    const bag = listenerBag();
    const sidebar = root.querySelector("[data-sidebar]");
    if (!sidebar) {
        return bag.cleanup;
    }

    const backdrop = root.querySelector("[data-sidebar-backdrop]");
    const openers = root.querySelectorAll("[data-sidebar-open]");

    const setOpen = (open) => {
        sidebar.classList.toggle("-translate-x-full", !open);
        backdrop?.classList.toggle("hidden", !open);
        openers.forEach((button) => button.setAttribute("aria-expanded", String(open)));
    };

    openers.forEach((button) => bag.on(button, "click", () => setOpen(true)));
    root.querySelectorAll("[data-sidebar-close]").forEach((button) => bag.on(button, "click", () => setOpen(false)));
    bag.on(backdrop, "click", () => setOpen(false));
    bag.on(window, "keydown", (event) => {
        if (event.key === "Escape" && !sidebar.classList.contains("-translate-x-full")) {
            setOpen(false);
        }
    });

    return bag.cleanup;
}

/**
 * Everything the Laravel app.js initialised on page load, minus the theme switch (src/lib/client/theme.ts).
 * Returns one cleanup function.
 */
export function initializeInteractions(root = document) {
    const cleanups = [
        initializeSidebar(root),
        ...[...root.querySelectorAll("[data-tabs]")].map(initializeTabs),
        initializeModals(root),
        initializeDismissals(root),
        initializeAccordions(root),
    ];

    return () => cleanups.forEach((cleanup) => cleanup());
}

/**
 * Programmatic modal helpers backed by initializeModals().
 */
export function openModal(name) {
    window.dispatchEvent(new CustomEvent("open-modal", { detail: String(name).replace(/^#/, "") }));
}

export function closeModal(name) {
    window.dispatchEvent(new CustomEvent("close-modal", { detail: String(name).replace(/^#/, "") }));
}
