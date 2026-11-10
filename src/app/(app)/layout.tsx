import type { ReactNode } from "react";

import { AppShell, type NavSection } from "@/components/app/app-shell";
import { env } from "@/env";
import { canManageData, canManageUsers } from "@/lib/roles";
import { requireUser } from "@/server/auth";

/**
 * Dashboard area layout (layouts/app.blade.php). Pages still check access themselves: layouts are
 * not re-rendered on every navigation.
 */
export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  const sections: NavSection[] = [
    {
      title: null,
      items: [
        { href: "/", icon: "map", label: "3D Map", match: "exact" },
        { href: "/dashboard", icon: "dashboard", label: "Dashboard", match: "exact" },
      ],
    },
  ];

  if (canManageData(user)) {
    sections.push({
      title: "Data Management",
      items: [
        { href: "/dashboard/layers", icon: "layers", label: "Layer Management", match: "prefix" },
        { href: "/dashboard/layer-categories", icon: "layer-categories", label: "Layer Categories", match: "prefix" },
      ],
    });
  }

  if (canManageUsers(user)) {
    sections.push({
      title: "Administration",
      items: [{ href: "/dashboard/users", icon: "users", label: "Users", match: "prefix" }],
    });
  }

  sections.push({
    title: "Developer",
    items: [{ href: "/api/api-docs", icon: "api-docs", label: "API Docs", match: "prefix" }],
  });

  sections.push({
    title: "Account",
    items: [{ href: "/profile", icon: "profile", label: "Edit Profile", match: "prefix" }],
  });

  return (
    <AppShell
      appName={env.APP_NAME}
      user={{ name: user.name, roleLabel: user.roleLabel, profilePhotoUrl: user.profilePhotoUrl }}
      sections={sections}
    >
      {children}
    </AppShell>
  );
}
