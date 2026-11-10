"use client";

/* eslint-disable @next/next/no-img-element -- profile photos are small, already-sized avatars */

import { LayoutDashboard, LogOut, Moon, MountainSnow, Sun, UserCog } from "lucide-react";
import Link from "next/link";
import { signOut } from "next-auth/react";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { useTheme } from "@/lib/client/theme";
import { useMapStore } from "@/stores/map-store";

export type MapMenuUser = {
  name: string;
  email: string;
  roleLabel: string;
  isAdmin: boolean;
  profilePhotoUrl: string | null;
};

const subscribeNothing = () => () => {};

/** Up to two initials of the user's name (shown when there is no profile photo). */
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? "")
    .slice(0, 2)
    .join("");
}

/**
 * Account menu in the map command bar (port of x-user-dropdown-menu). Its open state is
 * mapStore.userMenuOpen: the button toggles it, a click outside or Escape closes it, and switching
 * side panels closes it (store actions). Dark mode uses src/lib/client/theme.ts; signing out uses
 * NextAuth instead of the Laravel logout form.
 */
export function UserDropdownMenu({
  buttonId = "userMenuBtn",
  dropdownId = "userDropdown",
  user,
}: {
  buttonId?: string;
  dropdownId?: string;
  user: MapMenuUser;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  // false during SSR and hydration, true afterwards: the stored theme is only known in the browser.
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const isDark = hydrated && resolvedTheme === "dark";
  const initials = initialsOf(user.name);
  const open = useMapStore((state) => state.userMenuOpen);
  const setOpen = useMapStore((state) => state.setUserMenuOpen);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  return (
    <div ref={rootRef} className="relative flex-none">
      <button
        type="button"
        id={buttonId}
        className="map-avatar"
        aria-controls={dropdownId}
        aria-expanded={open}
        aria-label="Account menu"
        onClick={() => setOpen(!open)}
      >
        {user.profilePhotoUrl ? (
          <img src={user.profilePhotoUrl} alt="" />
        ) : (
          <span aria-hidden="true">{initials}</span>
        )}
      </button>

      <div
        id={dropdownId}
        className={`map-menu map-sheet ${open ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"}`}
      >
        <div className="flex items-center gap-3 border-b border-map-line p-3">
          <span className="map-avatar shrink-0" aria-hidden="true">
            {user.profilePhotoUrl ? <img src={user.profilePhotoUrl} alt="" /> : initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-map-ink">{user.name}</p>
              <span
                className={`${user.isAdmin ? "bg-map-accent-soft text-map-accent-ink" : "bg-map-success/12 text-map-success"} shrink-0 rounded-md px-1.5 py-0.5 text-[0.625rem] font-bold`}
              >
                {user.roleLabel}
              </span>
            </div>
            <p className="truncate text-xs text-map-subtle">{user.email}</p>
          </div>
        </div>

        <nav className="p-1.5" aria-label="Account">
          <Link href="/dashboard" className="map-menu-item">
            <LayoutDashboard size="1em" aria-hidden="true" />
            <span>Dashboard</span>
          </Link>
          <Link href="/profile" className="map-menu-item">
            <UserCog size="1em" aria-hidden="true" />
            <span>Edit profile</span>
          </Link>
          <button
            type="button"
            className="map-menu-item"
            data-theme-toggle=""
            aria-pressed={isDark}
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            <Moon size="1em" className="dark:hidden" aria-hidden="true" />
            <Sun size="1em" className="hidden dark:block" aria-hidden="true" />
            <span className="flex-1">Dark mode</span>
            <span className="map-switch-mini" aria-hidden="true"></span>
          </button>
          {/* Driven by src/lib/map/cesium-map.js (toggleDepthTestAgainstTerrain), which sets aria-pressed. */}
          <button type="button" id="depthTestToggle" className="map-menu-item" aria-pressed="false">
            <MountainSnow size="1em" aria-hidden="true" />
            <span className="flex min-w-0 flex-1 flex-col py-1.5">
              <span>Terrain depth test</span>
              <span className="text-[0.6875rem] font-normal text-map-subtle">Hide vectors behind terrain</span>
            </span>
            <span className="map-switch-mini" aria-hidden="true"></span>
          </button>
        </nav>

        <div className="border-t border-map-line p-1.5">
          <button
            type="button"
            className="map-menu-item map-menu-item--danger"
            onClick={() => signOut({ callbackUrl: "/login" })}
          >
            <LogOut size="1em" aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
