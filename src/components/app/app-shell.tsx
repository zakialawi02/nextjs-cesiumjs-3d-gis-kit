"use client";

/* eslint-disable @next/next/no-img-element -- small profile photos from /public, as in the Laravel layout */
import {
  CodeXml,
  Database,
  FolderKanban,
  Globe,
  LayoutDashboard,
  LogOut,
  Menu,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { ApplicationLogo } from "@/components/application-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";

/**
 * Dashboard frame (layouts/app.blade.php): off-canvas sidebar below lg with role-based navigation,
 * sticky header with the page title, theme toggle and user chip. The sidebar's open state lives in
 * the UI store (src/stores/ui-store.ts), shared by the header's menu button, the sidebar and its
 * backdrop.
 */

/** Navigation icons by key: the server layout sends keys, since components cannot cross to the client. */
const NAV_ICONS = {
  map: Globe,
  dashboard: LayoutDashboard,
  layers: Database,
  "layer-categories": FolderKanban,
  users: Users,
  "api-docs": CodeXml,
  profile: UserCog,
} satisfies Record<string, LucideIcon>;

export type NavIcon = keyof typeof NAV_ICONS;
export type NavItem = { href: string; icon: NavIcon; label: string; match: "exact" | "prefix" };
export type NavSection = { title: string | null; items: NavItem[] };

/** Header titles of the dashboard routes (the <title> comes from each page's metadata). */
const PAGE_TITLES: Array<[prefix: string, title: string]> = [
  ["/dashboard/layers", "Layer Management"],
  ["/dashboard/layer-categories", "Layer Categories"],
  ["/dashboard/users", "User Management"],
  ["/profile", "Edit Profile"],
  ["/dashboard", "Dashboard"],
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.match === "exact") return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AppShell({
  appName,
  user,
  sections,
  children,
}: {
  appName: string;
  user: { name: string; roleLabel: string; profilePhotoUrl: string };
  sections: NavSection[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const title = PAGE_TITLES.find(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`))?.[1] ?? "Dashboard";

  // Close the off-canvas menu after navigating (links, back/forward).
  useEffect(() => {
    useUiStore.getState().closeSidebar();
  }, [pathname]);

  return (
    <>
      {/* Sidebar (off-canvas below lg) */}
      <SidebarBackdrop />
      <Sidebar appName={appName} sections={sections} pathname={pathname} />

      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border bg-neutral/90 backdrop-blur lg:ps-64">
        <div className="flex items-center gap-3 px-4 py-2.5 sm:px-6">
          <MenuButton />
          <h1 className="truncate text-base font-bold text-foreground">{title}</h1>

          <div className="ms-auto flex items-center gap-2">
            <ThemeToggle />
            <div className="flex items-center gap-2 rounded-full border border-border py-1 pe-3 ps-1">
              <img src={user.profilePhotoUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
              <div className="hidden leading-tight sm:block">
                <p className="max-w-40 truncate text-xs font-bold text-foreground">{user.name}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground/60">{user.roleLabel}</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="lg:ps-64">
        <div className="w-full p-4 sm:p-6">{children}</div>
      </main>
    </>
  );
}

/** Header button that opens the sidebar below lg. */
function MenuButton() {
  const open = useUiStore((state) => state.sidebarOpen);
  const openSidebar = useUiStore((state) => state.openSidebar);

  return (
    <button
      type="button"
      className="rounded-lg border border-border p-1.5 text-foreground/70 hover:bg-muted lg:hidden"
      onClick={openSidebar}
      aria-controls="dashboardSidebar"
      aria-expanded={open}
      aria-label="Open menu"
    >
      <Menu className="size-4.5" aria-hidden="true" />
    </button>
  );
}

/** Dimmed page behind the open sidebar; clicking it closes the sidebar. */
function SidebarBackdrop() {
  const open = useUiStore((state) => state.sidebarOpen);
  const closeSidebar = useUiStore((state) => state.closeSidebar);

  return (
    <div
      className={cn("fixed inset-0 z-40 bg-black/40 lg:hidden", open ? "block" : "hidden")}
      onClick={closeSidebar}
      aria-hidden="true"
    ></div>
  );
}

function Sidebar({ appName, sections, pathname }: { appName: string; sections: NavSection[]; pathname: string }) {
  const open = useUiStore((state) => state.sidebarOpen);
  const closeSidebar = useUiStore((state) => state.closeSidebar);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeSidebar]);

  function handleSignOut() {
    setSigningOut(true);
    signOut({ callbackUrl: "/login" }).catch(() => setSigningOut(false));
  }

  return (
    <aside
      id="dashboardSidebar"
      className={cn(
        "fixed inset-y-0 start-0 z-50 flex w-64 flex-col border-e border-border bg-neutral transition-transform duration-300 lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full",
      )}
      aria-label="Dashboard navigation"
    >
      <div className="flex items-center justify-between px-5 py-3">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <ApplicationLogo className="h-9 w-9" alt={appName} />
          <span className="text-sm font-extrabold uppercase tracking-wider text-primary">{appName}</span>
        </Link>
        <button
          type="button"
          className="rounded-lg p-1.5 text-foreground/60 hover:bg-muted lg:hidden"
          onClick={closeSidebar}
          aria-label="Close menu"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-2">
        {sections.map((section, index) => (
          <div key={section.title ?? `section-${index}`}>
            {section.title ? (
              <p className="mb-1 mt-4 px-3 text-[10px] font-bold uppercase tracking-wider text-foreground/45">
                {section.title}
              </p>
            ) : null}
            <ul className="space-y-1">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} active={isActive(pathname, item)} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold text-error transition-colors hover:bg-error/10 disabled:opacity-60"
        >
          <LogOut className="size-4.5" aria-hidden="true" />
          <span>Sign Out</span>
        </button>
      </div>
    </aside>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = NAV_ICONS[item.icon];

  return (
    <li>
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          active ? "bg-primary/10 text-primary" : "text-foreground/75 hover:bg-muted hover:text-primary",
        )}
      >
        <Icon className="size-4.5 shrink-0" aria-hidden="true" />
        <span>{item.label}</span>
      </Link>
    </li>
  );
}
