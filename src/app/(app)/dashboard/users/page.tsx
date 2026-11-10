import type { Prisma } from "@prisma/client";
import type { Metadata } from "next";

import { Pagination } from "@/components/app/pagination";
import { isUserRole, USER_ROLE_LABELS, USER_ROLES, UserRole } from "@/lib/enums";
import { diffForHumans } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/server/auth";
import { formatTimestamp } from "@/server/dashboard/format";
import { paginate, PER_PAGE, queryFromSearchParams, resolvePage } from "@/server/dashboard/pagination";

import { UsersManager, type UserRow } from "./users-manager";

export const metadata: Metadata = { title: "User Management" };

const PATH = "/dashboard/users";
const DEFAULT_PHOTO = "/assets/img/profile/user.png";

/** UserController::index: searchable, role-filterable list of active accounts. */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await requireAdmin(PATH);

  const query = queryFromSearchParams(await searchParams);
  const filters = {
    search: (query.search ?? "").trim(),
    role: isUserRole(query.role) ? query.role : null,
  };
  const page = resolvePage(query.page);

  const where: Prisma.UserWhereInput = {
    deleted_at: null,
    ...(filters.search !== ""
      ? {
          OR: [
            { name: { contains: filters.search, mode: "insensitive" } },
            { username: { contains: filters.search, mode: "insensitive" } },
            { email: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(filters.role ? { role: filters.role } : {}),
  };

  const [total, users, roleGroups] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        role: true,
        profile_photo_path: true,
        created_at: true,
        _count: { select: { layers: true } },
      },
    }),
    prisma.user.groupBy({ by: ["role"], where: { deleted_at: null }, _count: { _all: true } }),
  ]);

  const roleCounts = Object.fromEntries(roleGroups.map((group) => [group.role, group._count._all])) as Record<string, number>;
  const now = new Date();

  const rows: UserRow[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    roleLabel: isUserRole(user.role) ? USER_ROLE_LABELS[user.role] : user.role,
    photoUrl: user.profile_photo_path || DEFAULT_PHOTO,
    layerCount: user._count.layers,
    joinedAgo: user.created_at ? diffForHumans(user.created_at, now) : "—",
    joinedTitle: formatTimestamp(user.created_at),
    isSelf: user.id === currentUser.id,
  }));

  const paginator = paginate({ total, currentPage: page, itemCount: users.length, path: PATH, query });

  return (
    <UsersManager
      rows={rows}
      filters={filters}
      roles={USER_ROLES.map((role) => ({ value: role, label: USER_ROLE_LABELS[role], count: roleCounts[role] ?? 0 }))}
      allCount={Object.values(roleCounts).reduce((sum, count) => sum + count, 0)}
      defaultRole={UserRole.Engineering}
      pagination={paginator.hasPages ? <Pagination paginator={paginator} /> : null}
    />
  );
}
