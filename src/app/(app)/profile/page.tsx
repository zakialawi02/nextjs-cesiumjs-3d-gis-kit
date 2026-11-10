/* eslint-disable @next/next/no-img-element -- profile photos are small files from /public */
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { formatDate } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { isAdmin } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth";

import { PasswordForm, ProfileForm } from "./profile-forms";

export const metadata: Metadata = { title: "Edit Profile" };

/** ProfileController::edit (pages/dashboard/profile/edit.blade.php). */
export default async function ProfilePage() {
  const user = await requireUser("/profile");

  const account = await prisma.user.findFirst({
    where: { id: user.id, deleted_at: null },
    select: { name: true, username: true, email: true, created_at: true, password: true },
  });
  if (!account) redirect("/login");

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Account summary */}
      <section className="h-fit rounded-xl border border-border bg-neutral p-6 text-center shadow-sm">
        <img src={user.profilePhotoUrl} alt="" className="mx-auto h-20 w-20 rounded-full border-2 border-border object-cover" />
        <h2 className="mt-3 text-lg font-bold text-foreground">{account.name}</h2>
        <p className="text-sm text-foreground/60">@{account.username}</p>
        <span
          className={cn(
            "mt-3 inline-flex rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider",
            isAdmin(user) ? "bg-primary/10 text-primary" : "bg-success/10 text-success",
          )}
        >
          {user.roleLabel}
        </span>
        <p className="mt-4 text-xs text-foreground/50">Member since {formatDate(account.created_at)}</p>
      </section>

      <div className="space-y-6 lg:col-span-2">
        {/* Profile information */}
        <section className="rounded-xl border border-border bg-neutral shadow-sm">
          <header className="border-b border-border px-6 py-4">
            <h3 className="text-base font-bold text-foreground">Profile Information</h3>
            <p className="text-xs text-foreground/60">Update your account&apos;s name, username and email.</p>
          </header>

          <ProfileForm
            key={`${account.name}|${account.username}|${account.email}`}
            defaults={{ name: account.name, username: account.username, email: account.email }}
          />
        </section>

        {/* Password */}
        <section className="rounded-xl border border-border bg-neutral shadow-sm">
          <header className="border-b border-border px-6 py-4">
            <h3 className="text-base font-bold text-foreground">Change Password</h3>
            <p className="text-xs text-foreground/60">At least 8 characters. Sessions on other devices will be signed out.</p>
          </header>

          <PasswordForm hasPassword={account.password !== null} />
        </section>
      </div>
    </div>
  );
}
