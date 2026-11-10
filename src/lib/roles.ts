import { isUserRole, UserRole } from "@/lib/enums";

/**
 * Role checks (port of app/Traits/HasRoles.php). Works on any object with a `role` string,
 * so it is shared by the session user, Prisma rows and client components.
 */
type HasRole = { role: string | null | undefined } | null | undefined;

export function hasRole(user: HasRole, roles: UserRole | string | Array<UserRole | string>): boolean {
  if (!user?.role) return false;
  const wanted = Array.isArray(roles) ? roles : [roles];
  return wanted.some((role) => isUserRole(role) && user.role === role);
}

export function isAdmin(user: HasRole): boolean {
  return user?.role === UserRole.Admin;
}

export function isEngineering(user: HasRole): boolean {
  return user?.role === UserRole.Engineering;
}

/** Admins upload geodata through the Data panel. */
export function canUploadData(user: HasRole): boolean {
  return isAdmin(user);
}

/** Admins manage published layers and categories (rename, archive, delete). */
export function canManageData(user: HasRole): boolean {
  return isAdmin(user);
}

/** Admins create, edit and delete user accounts. */
export function canManageUsers(user: HasRole): boolean {
  return isAdmin(user);
}
