"use server";

import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { USER_ROLES, UserRole } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/server/auth";
import {
  accountFields,
  addUniqueAccountErrors,
  normalizeAccountInput,
  uniqueViolationErrors,
} from "@/server/dashboard/accounts";
import {
  formValues,
  invalid,
  messages,
  nullableString,
  passwordIssues,
  requiredString,
  zodFieldErrors,
  type ActionResult,
  type FieldErrors,
} from "@/server/dashboard/validation";
import { reissueSessionCookie } from "@/server/session-cookie";

const USERS_PATH = "/dashboard/users";
const LAST_ADMIN_MESSAGE = "At least one admin must remain. Make another user an admin first.";

class LastAdminError extends Error {}

function userId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-fA-F-]{36}$/.test(value) ? value : null;
}

/**
 * Locks every active admin row (in a stable order) and reports whether an admin other than `id`
 * remains, so two admins cannot demote or delete each other at the same time.
 */
async function anotherAdminRemains(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
  const admins = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM users
    WHERE role = ${UserRole.Admin} AND deleted_at IS NULL
    ORDER BY id
    FOR UPDATE`;
  return admins.some((admin) => admin.id !== id);
}

/**
 * UserController::store / update (SaveUserRequest). `id` null creates an account; on update a
 * blank password keeps the current one.
 */
export async function saveUserAction(id: string | null, formData: FormData): Promise<ActionResult> {
  const currentUser = await requireAdmin();

  let edited: { id: string } | null = null;
  if (id !== null) {
    const key = userId(id);
    edited = key ? await prisma.user.findFirst({ where: { id: key, deleted_at: null }, select: { id: true } }) : null;
    if (!edited) return { ok: false, message: "User not found." };
  }

  const input = normalizeAccountInput(formValues(formData, ["name", "username", "email", "role", "password", "password_confirmation"]));
  const roleMessage = messages.enum("role");

  const schema = z.object({
    ...accountFields,
    role: requiredString("role").refine((value) => (USER_ROLES as string[]).includes(value), { message: roleMessage }),
    password: (edited ? nullableString("password") : requiredString("password")).superRefine((password, ctx) => {
      if (typeof password !== "string") return;
      for (const message of passwordIssues(password, input.password_confirmation)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      }
    }),
  });

  const parsed = schema.safeParse(input);
  const errors: FieldErrors = parsed.success ? {} : zodFieldErrors(parsed.error);
  await addUniqueAccountErrors(errors, input, edited?.id ?? null);

  // after(): admins may edit their own account here but never drop their own admin role.
  if (!errors.role && edited?.id === currentUser.id && input.role !== UserRole.Admin) {
    errors.role = ["You cannot remove your own admin role."];
  }

  if (!parsed.success || Object.keys(errors).length > 0) return invalid(errors);

  const { name, username, email, role, password } = parsed.data;
  const passwordHash = password ? await bcrypt.hash(password, 12) : null;

  try {
    if (!edited) {
      await prisma.user.create({
        data: { name, username, email, role, password: passwordHash, email_verified_at: new Date() },
      });
      revalidatePath(USERS_PATH);
      return { ok: true, message: `User "${name}" created.` };
    }

    const editedId = edited.id;
    await prisma.$transaction(async (tx) => {
      if (role !== UserRole.Admin) {
        // Lock the admin rows first, then read the role that is current under that lock.
        const remains = await anotherAdminRemains(tx, editedId);
        const current = await tx.user.findUnique({ where: { id: editedId }, select: { role: true } });
        if (current?.role === UserRole.Admin && !remains) throw new LastAdminError();
      }
      await tx.user.update({
        where: { id: editedId },
        data: { name, username, email, role, ...(passwordHash ? { password: passwordHash } : {}) },
      });
    });
  } catch (error) {
    if (error instanceof LastAdminError) return invalid({ role: [LAST_ADMIN_MESSAGE] });
    const unique = uniqueViolationErrors(error);
    if (unique) return invalid(unique);
    throw error;
  }

  // A new password signs out every session of the account; keep the admin's own browser signed in.
  if (passwordHash && edited.id === currentUser.id) await reissueSessionCookie(passwordHash);

  revalidatePath("/", "layout");
  return { ok: true, message: `User "${name}" updated.` };
}

/** UserController::destroy: soft delete. Admins cannot delete themselves or the last admin. */
export async function deleteUserAction(id: string): Promise<ActionResult> {
  const currentUser = await requireAdmin();

  const key = userId(id);
  const user = key
    ? await prisma.user.findFirst({ where: { id: key, deleted_at: null }, select: { id: true, name: true } })
    : null;
  if (!user) return { ok: false, message: "User not found." };

  if (user.id === currentUser.id) return { ok: false, message: "You cannot delete your own account." };

  const deleted = await prisma.$transaction(async (tx) => {
    const remains = await anotherAdminRemains(tx, user.id);
    const current = await tx.user.findUnique({ where: { id: user.id }, select: { role: true } });
    if (current?.role === UserRole.Admin && !remains) return false;
    const result = await tx.user.updateMany({ where: { id: user.id, deleted_at: null }, data: { deleted_at: new Date() } });
    return result.count > 0;
  });

  if (!deleted) return { ok: false, message: LAST_ADMIN_MESSAGE };

  revalidatePath(USERS_PATH);
  return { ok: true, message: `User "${user.name}" deleted.` };
}
