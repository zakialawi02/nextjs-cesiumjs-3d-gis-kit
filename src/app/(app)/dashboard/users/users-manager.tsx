"use client";

/* eslint-disable @next/next/no-img-element -- small profile photos from /public */
import { AtSign, LoaderCircle, Lock, LockKeyhole, Mail, Pencil, Save, Search, Trash2, User, UserPlus, Users, X } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";

import { GENERIC_ERROR, rethrowNavigationError } from "@/components/app/action-helpers";
import { ButtonLight, ButtonPrimary } from "@/components/app/buttons";
import { EmptyState } from "@/components/app/empty-state";
import { InputError, InputLabel, SelectInput, TextInput } from "@/components/app/form-fields";
import { Modal, ModalCloseButton, ModalTitle } from "@/components/app/modal";
import { confirmPopup, DANGER_ICON } from "@/lib/client/popup-alert";
import { toast } from "@/lib/client/toast";
import { cn } from "@/lib/utils";
import type { FieldErrors } from "@/server/dashboard/validation";
import { createRecordDialogStore } from "@/stores/record-dialog-store";
import { createScopedStore } from "@/stores/scoped-store";

import { deleteUserAction, saveUserAction } from "./actions";

export type UserRow = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: string;
  roleLabel: string;
  photoUrl: string;
  layerCount: number;
  joinedAgo: string;
  joinedTitle: string;
  isSelf: boolean;
};

type RoleOption = { value: string; label: string; count: number };

const PATH = "/dashboard/users";
const ROLE_STYLES: Record<string, string> = {
  admin: "bg-primary/10 text-primary",
  engineering: "bg-secondary/20 text-foreground/70",
};

function filterUrl(search: string, role: string | null): string {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (role) params.set("role", role);
  const query = params.toString();
  return query ? `${PATH}?${query}` : PATH;
}

/** The create/edit modal's user (`null` creates), shared by the "New" button, the rows and the modal. */
const [UserDialogProvider, useUserDialog] = createScopedStore("UserDialog", () => createRecordDialogStore<"form", UserRow>());

type ManagerProps = {
  rows: UserRow[];
  filters: { search: string; role: string | null };
  roles: RoleOption[];
  allCount: number;
  defaultRole: string;
  pagination: ReactNode;
};

/** Port of pages/dashboard/users/index.blade.php (filters, list, create/edit modal, delete). */
export function UsersManager({ roles, defaultRole, ...props }: ManagerProps) {
  return (
    <UserDialogProvider>
      <UsersList roles={roles} {...props} />
      <UserFormModal roles={roles} defaultRole={defaultRole} />
    </UserDialogProvider>
  );
}

function UsersList({ rows, filters, roles, allCount, pagination }: Omit<ManagerProps, "defaultRole">) {
  const openDialog = useUserDialog((state) => state.openDialog);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const hasFilters = filters.search !== "" || Boolean(filters.role);
  const chipClass = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-semibold transition",
      active ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground/70 hover:bg-muted",
    );

  async function remove(row: UserRow) {
    const confirmed = await confirmPopup({
      message: `Delete user "${row.name}"? They will no longer be able to sign in.`,
      icon: DANGER_ICON,
      confirmText: "OK",
      cancelText: "Cancel",
    });
    if (!confirmed) return;

    setDeletingId(row.id);
    startTransition(async () => {
      try {
        const result = await deleteUserAction(row.id);
        if (result.ok) toast.success(result.message);
        else toast.error(result.message ?? GENERIC_ERROR);
      } catch (error) {
        rethrowNavigationError(error);
        toast.error(GENERIC_ERROR);
      } finally {
        setDeletingId(null);
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-foreground">User Management</h2>
          <p className="text-sm text-foreground/60">
            Create accounts, assign roles and reset passwords. Admins manage data and users; Engineering users view the map.
          </p>
        </div>
        <ButtonPrimary type="button" className="text-sm" onClick={() => openDialog("form", null)}>
          <UserPlus className="size-3.5" aria-hidden="true" /> New User
        </ButtonPrimary>
      </section>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {/* Role chips (quick filters) */}
        <nav className="flex flex-wrap gap-2" aria-label="Filter by role">
          <Link
            href={filterUrl(filters.search, null)}
            aria-current={!filters.role ? "page" : undefined}
            className={chipClass(!filters.role)}
          >
            All <span className="opacity-70">{allCount}</span>
          </Link>
          {roles.map((role) => (
            <Link
              key={role.value}
              href={filterUrl(filters.search, role.value)}
              aria-current={filters.role === role.value ? "page" : undefined}
              className={chipClass(filters.role === role.value)}
            >
              {role.label} <span className="opacity-70">{role.count}</span>
            </Link>
          ))}
        </nav>

        {/* Search */}
        <Form action={PATH} className="flex w-full gap-2 md:max-w-sm">
          {filters.role ? <input type="hidden" name="role" value={filters.role} /> : null}
          <div className="flex-1">
            <label htmlFor="search" className="sr-only">
              Search
            </label>
            <TextInput
              id="search"
              name="search"
              type="search"
              icon={Search}
              placeholder="Search name, username or email..."
              defaultValue={filters.search}
              key={filters.search}
            />
          </div>
          {hasFilters ? (
            <Link
              href={PATH}
              className="inline-flex items-center justify-center rounded-[0.625rem] border border-border px-3 text-sm hover:bg-muted"
              title="Reset filters"
              aria-label="Reset filters"
            >
              <X className="size-3.5" aria-hidden="true" />
            </Link>
          ) : null}
        </Form>
      </div>

      {/* Table */}
      <section className="overflow-hidden rounded-xl border border-border bg-neutral shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-muted/50 text-[11px] font-bold uppercase tracking-wider text-foreground/60">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Layers</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length > 0 ? (
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <img src={row.photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border border-border object-cover" />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 font-semibold text-foreground">
                            <span className="max-w-xs truncate">{row.name}</span>
                            {row.isSelf ? (
                              <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase text-foreground/60">You</span>
                            ) : null}
                          </p>
                          <p className="font-mono text-[11px] text-foreground/50">@{row.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground/80">{row.email}</td>
                    <td className="px-4 py-3">
                      <span className={cn(ROLE_STYLES[row.role] ?? "bg-muted", "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase")}>
                        {row.roleLabel}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground/70">{row.layerCount}</td>
                    <td className="px-4 py-3 text-xs text-foreground/60" title={row.joinedTitle}>
                      {row.joinedAgo}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          className="rounded-md p-1.5 text-foreground/60 hover:bg-primary/10 hover:text-primary"
                          title="Edit"
                          aria-label={`Edit ${row.name}`}
                          onClick={() => openDialog("form", row)}
                        >
                          <Pencil className="size-4" aria-hidden="true" />
                        </button>
                        {row.isSelf ? (
                          <span className="cursor-not-allowed p-1.5 text-foreground/25" title="You cannot delete your own account">
                            <Lock className="size-4" aria-hidden="true" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="rounded-md p-1.5 text-foreground/60 hover:bg-error/10 hover:text-error disabled:opacity-40"
                            title="Delete"
                            aria-label={`Delete ${row.name}`}
                            disabled={deletingId === row.id}
                            onClick={() => remove(row)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>
                    <EmptyState
                      icon={Users}
                      iconClass="size-7.5"
                      message={hasFilters ? "No users match these filters." : "No users yet."}
                      containerClass="py-12"
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pagination ? <div className="border-t border-border px-4 py-3">{pagination}</div> : null}
      </section>
    </div>
  );
}

function UserFormModal({ roles, defaultRole }: { roles: RoleOption[]; defaultRole: string }) {
  const open = useUserDialog((state) => state.kind === "form");
  const row = useUserDialog((state) => state.row);
  const session = useUserDialog((state) => state.session);
  const closeDialog = useUserDialog((state) => state.closeDialog);

  return (
    <Modal open={open} onOpenChange={(next) => next || closeDialog()} maxWidth="lg">
      <UserForm key={session} row={row} roles={roles} defaultRole={defaultRole} onDone={closeDialog} />
    </Modal>
  );
}

type FormState = { name: string; username: string; email: string; role: string };

/** Create (`row` null) / edit form; remounted for every opening, so it starts from the row's values. */
function UserForm({
  row,
  roles,
  defaultRole,
  onDone,
}: {
  row: UserRow | null;
  roles: RoleOption[];
  defaultRole: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState<FormState>({
    name: row?.name ?? "",
    username: row?.username ?? "",
    email: row?.email ?? "",
    role: row?.role ?? defaultRole,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, startSaving] = useTransition();
  const isEdit = row !== null;
  const isSelf = row?.isSelf ?? false;

  function update(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = row?.id ?? null;

    startSaving(async () => {
      try {
        const result = await saveUserAction(id, data);
        if (result.ok) {
          toast.success(result.message);
          onDone();
        } else if (result.errors) {
          setErrors(result.errors);
        } else {
          toast.error(result.message ?? GENERIC_ERROR);
        }
      } catch (error) {
        rethrowNavigationError(error);
        toast.error(GENERIC_ERROR);
      }
    });
  }

  return (
    <form className="space-y-4 p-6" onSubmit={submit} autoComplete="off">
      <div className="flex items-center justify-between">
        <ModalTitle>{isEdit ? "Edit User" : "New User"}</ModalTitle>
        <ModalCloseButton />
      </div>

      <div>
        <InputLabel htmlFor="user_name" value="Name" />
        <TextInput
          id="user_name"
          name="name"
          type="text"
          icon={User}
          required
          maxLength={255}
          autoComplete="off"
          value={form.name}
          onChange={(event) => update("name", event.target.value)}
          isError={Boolean(errors.name)}
        />
        <InputError messages={errors.name} className="mt-1" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <InputLabel htmlFor="user_username" value="Username" />
          <TextInput
            id="user_username"
            name="username"
            type="text"
            icon={AtSign}
            required
            minLength={3}
            maxLength={50}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            value={form.username}
            onChange={(event) => update("username", event.target.value)}
            isError={Boolean(errors.username)}
          />
          <InputError messages={errors.username} className="mt-1" />
        </div>
        <div>
          <InputLabel htmlFor="user_role" value="Role" />
          <SelectInput
            id="user_role"
            name={isSelf ? undefined : "role"}
            className="w-full disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSelf}
            value={isSelf ? "admin" : form.role}
            onChange={(event) => update("role", event.target.value)}
          >
            {roles.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </SelectInput>
          {/* A disabled select is not submitted, so the locked own-role is sent through this input instead. */}
          {isSelf ? <input type="hidden" name="role" value="admin" /> : null}
          {isSelf ? <p className="mt-1 text-xs text-foreground/60">You cannot change your own role.</p> : null}
          <InputError messages={errors.role} className="mt-1" />
        </div>
      </div>

      <div>
        <InputLabel htmlFor="user_email" value="Email" />
        <TextInput
          id="user_email"
          name="email"
          type="email"
          icon={Mail}
          required
          maxLength={255}
          autoComplete="off"
          value={form.email}
          onChange={(event) => update("email", event.target.value)}
          isError={Boolean(errors.email)}
        />
        <InputError messages={errors.email} className="mt-1" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <InputLabel htmlFor="user_password" value="Password" />
          <TextInput
            id="user_password"
            name="password"
            type="password"
            icon={LockKeyhole}
            required={!isEdit}
            minLength={8}
            autoComplete="new-password"
            isError={Boolean(errors.password)}
          />
          <InputError messages={errors.password} className="mt-1" />
        </div>
        <div>
          <InputLabel htmlFor="user_password_confirmation" value="Confirm Password" />
          <TextInput
            id="user_password_confirmation"
            name="password_confirmation"
            type="password"
            icon={LockKeyhole}
            autoComplete="new-password"
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-foreground/60">
        {isEdit ? "At least 8 characters. Leave blank to keep the current password." : "At least 8 characters."}
      </p>

      <div className="flex justify-end gap-2 pt-2">
        <ButtonLight type="button" onClick={onDone}>
          Cancel
        </ButtonLight>
        <ButtonPrimary type="submit" disabled={saving}>
          {saving ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}{" "}
          Save
        </ButtonPrimary>
      </div>
    </form>
  );
}
