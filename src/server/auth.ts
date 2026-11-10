import { getServerSession } from "next-auth";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";

import { authOptions } from "@/lib/auth";
import { isUserRole, USER_ROLE_LABELS, type UserRole } from "@/lib/enums";
import { hasRole } from "@/lib/roles";
import { HttpError } from "@/server/http";

export type CurrentUser = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: UserRole;
  roleLabel: string;
  profilePhotoUrl: string;
};

/**
 * The signed-in user for this request, or null. The jwt callback re-reads the user from the
 * database, so role / name / deletion are always current. Cached per request.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getServerSession(authOptions);
  const user = session?.user;
  if (!user?.id || session?.invalid || !isUserRole(user.role)) return null;

  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    role: user.role,
    roleLabel: USER_ROLE_LABELS[user.role],
    profilePhotoUrl: user.image || "/assets/img/profile/user.png",
  };
});

/** Pages / Server Actions: the signed-in user, or a redirect to the login page. */
export async function requireUser(redirectTo?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login");
  }
  return user;
}

/** Pages / Server Actions: the signed-in user with one of `roles`, else 403 (forbidden.tsx). */
export async function requireRole(roles: UserRole | UserRole[], redirectTo?: string): Promise<CurrentUser> {
  const user = await requireUser(redirectTo);
  if (!hasRole(user, roles)) forbidden();
  return user;
}

export function requireAdmin(redirectTo?: string): Promise<CurrentUser> {
  return requireRole("admin", redirectTo);
}

/** Route handlers: the signed-in user (with one of `roles` when given), else a 401 / 403 HttpError. */
export async function requireApiUser(roles?: UserRole | UserRole[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401);
  if (roles && !hasRole(user, roles)) throw new HttpError(403);
  return user;
}
