import type { Prisma } from "@prisma/client";
import {
  CloudSun,
  Compass,
  Folders,
  Globe,
  History,
  Layers,
  LoaderCircle,
  MoonStar,
  Mountain,
  Shapes,
  Sun,
  Sunrise,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";

import { ButtonPrimary } from "@/components/app/buttons";
import { EmptyState } from "@/components/app/empty-state";
import { JOB_STATUS_LABELS, JobStatus, LayerStatus, LayerType } from "@/lib/enums";
import { diffForHumans } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { isAdmin as userIsAdmin } from "@/lib/roles";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth";
import { formatDayDate, greetingFor, numberFormat, statusLabel, ucfirst, type DayPeriod } from "@/server/dashboard/format";

export const metadata: Metadata = { title: "Dashboard" };

const GREETING_ICONS: Record<DayPeriod, LucideIcon> = {
  morning: Sunrise,
  afternoon: Sun,
  evening: CloudSun,
  night: MoonStar,
};

function jobTone(status: string): string {
  if (status === JobStatus.Done) return "bg-success/10 text-success";
  if (status === JobStatus.Failed) return "bg-error/10 text-error";
  return "bg-primary/10 text-primary";
}

function layerTone(status: string): string {
  if (status === LayerStatus.Published) return "bg-success/10 text-success";
  if (status === LayerStatus.ProcessFailed) return "bg-error/10 text-error";
  return "bg-primary/10 text-primary";
}

/**
 * DashboardController::index: admins see every layer and the processing pipeline, engineering users
 * see published layers.
 */
export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const isAdmin = userIsAdmin(user);
  const layers: Prisma.LayerWhereInput = isAdmin ? {} : { status: LayerStatus.Published };

  const [layerCount, terrainCount, vectorCount, categoryCount, recentLayers, adminStats, recentJobs] = await Promise.all([
    prisma.layer.count({ where: layers }),
    prisma.layer.count({ where: { ...layers, layer_type: LayerType.Terrain } }),
    prisma.layer.count({ where: { ...layers, layer_type: LayerType.Vector } }),
    prisma.layerCategory.count(),
    prisma.layer.findMany({
      where: layers,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      take: 5,
      select: {
        id: true,
        name: true,
        layer_type: true,
        status: true,
        created_at: true,
        category: { select: { name: true } },
      },
    }),
    isAdmin
      ? Promise.all([
          prisma.conversionJob.count({ where: { status: { in: [JobStatus.Queued, JobStatus.Processing] } } }),
          prisma.conversionJob.count({ where: { status: JobStatus.Failed } }),
          prisma.user.count({ where: { deleted_at: null } }),
        ])
      : null,
    isAdmin
      ? prisma.conversionJob.findMany({
          orderBy: [{ created_at: "desc" }, { id: "desc" }],
          take: 5,
          select: {
            id: true,
            layer_type: true,
            status: true,
            created_at: true,
            finished_at: true,
            source_file: { select: { original_name: true } },
            layer: { select: { name: true } },
          },
        })
      : [],
  ]);

  const [activeJobs, failedJobs, userCount] = adminStats ?? [0, 0, 0];
  const now = new Date();
  const [greeting, dayPeriod] = greetingFor(now.getHours());
  const GreetingIcon = GREETING_ICONS[dayPeriod];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <section className="rounded-xl border border-border bg-neutral p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-secondary/15 text-secondary">
              <Globe className="size-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="flex items-center gap-2 text-xl font-extrabold text-foreground md:text-2xl">
                <GreetingIcon className="size-4.5 shrink-0 text-secondary" aria-hidden="true" />
                <span>
                  {greeting}, <span className="text-primary">{user.name}</span>
                </span>
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground/55">
                <span>{user.roleLabel}</span>
                <span className="text-foreground/30">•</span>
                <span>{formatDayDate(now)}</span>
              </p>
            </div>
          </div>
          <ButtonPrimary href="/" className="shrink-0 text-sm">
            <Compass className="size-3.5" aria-hidden="true" />
            <span>Open 3D Map</span>
          </ButtonPrimary>
        </div>
      </section>

      {/* Metrics */}
      <section className={cn("grid grid-cols-1 gap-4 sm:grid-cols-2", isAdmin && "xl:grid-cols-4")} aria-label="Summary">
        <div className="rounded-xl border border-border bg-neutral p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-foreground/60">
                {isAdmin ? "Total Layers" : "Available Layers"}
              </p>
              <p className="mt-2 text-3xl font-extrabold text-foreground">{numberFormat(layerCount)}</p>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Layers className="size-5" aria-hidden="true" />
            </span>
          </div>
          <div className="mt-4 flex items-center gap-4 border-t border-border/60 pt-3 text-xs text-foreground/60">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-amber-500"></span>
              {terrainCount} Terrain
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-sky-500"></span>
              {vectorCount} Vector
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-neutral p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-foreground/60">Layer Categories</p>
              <p className="mt-2 text-3xl font-extrabold text-foreground">{numberFormat(categoryCount)}</p>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/10 text-rose-500">
              <Folders className="size-5" aria-hidden="true" />
            </span>
          </div>
          <div className="mt-4 border-t border-border/60 pt-3 text-xs text-foreground/60">
            Groups shown in the map&apos;s Layer panel
          </div>
        </div>

        {isAdmin ? (
          <>
            <div className="rounded-xl border border-border bg-neutral p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-foreground/60">Conversions</p>
                  <p className="mt-2 text-3xl font-extrabold text-foreground">{numberFormat(activeJobs)}</p>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
                  <LoaderCircle className="size-5" aria-hidden="true" />
                </span>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-foreground/60">
                <span>Running / queued</span>
                <span className={cn("font-bold", failedJobs > 0 && "text-error")}>{failedJobs} failed</span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-neutral p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wider text-foreground/60">Users</p>
                  <p className="mt-2 text-3xl font-extrabold text-foreground">{numberFormat(userCount)}</p>
                </div>
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <Users className="size-5" aria-hidden="true" />
                </span>
              </div>
              <div className="mt-4 border-t border-border/60 pt-3 text-xs text-foreground/60">Admin &amp; Engineering</div>
            </div>
          </>
        ) : null}
      </section>

      {/* Recent activity */}
      <section className={cn("grid grid-cols-1 gap-4", isAdmin && "lg:grid-cols-2")}>
        <div className="rounded-xl border border-border bg-neutral shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <h3 className="text-sm font-bold text-foreground">Latest Layers</h3>
            <Layers className="size-4 text-foreground/40" aria-hidden="true" />
          </div>
          <ul className="divide-y divide-border">
            {recentLayers.length > 0 ? (
              recentLayers.map((layer) => (
                <li key={layer.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground/70">
                    {layer.layer_type === LayerType.Terrain ? (
                      <Mountain className="size-4" aria-hidden="true" />
                    ) : (
                      <Shapes className="size-4" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{layer.name}</p>
                    <p className="truncate text-[11px] text-foreground/50">
                      {layer.category?.name ?? "Other"} • {diffForHumans(layer.created_at, now)}
                    </p>
                  </div>
                  {isAdmin ? (
                    <span className={cn(layerTone(layer.status), "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase")}>
                      {statusLabel(layer.status)}
                    </span>
                  ) : null}
                </li>
              ))
            ) : (
              <li>
                <EmptyState icon={Layers} iconClass="size-6" message="No layers yet" containerClass="py-8" />
              </li>
            )}
          </ul>
        </div>

        {isAdmin ? (
          <div className="rounded-xl border border-border bg-neutral shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <h3 className="text-sm font-bold text-foreground">Latest Conversions</h3>
              <LoaderCircle className="size-4 text-foreground/40" aria-hidden="true" />
            </div>
            <ul className="divide-y divide-border">
              {recentJobs.length > 0 ? (
                recentJobs.map((job) => (
                  <li key={job.id} className="flex items-center gap-3 px-5 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {job.layer?.name ?? job.source_file?.original_name ?? "—"}
                      </p>
                      <p className="text-[11px] text-foreground/50">
                        {ucfirst(job.layer_type)} • {diffForHumans(job.finished_at ?? job.created_at, now)}
                      </p>
                    </div>
                    <span className={cn(jobTone(job.status), "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase")}>
                      {JOB_STATUS_LABELS[job.status as JobStatus] ?? job.status}
                    </span>
                  </li>
                ))
              ) : (
                <li>
                  <EmptyState icon={History} iconClass="size-6" message="No conversions yet" containerClass="py-8" />
                </li>
              )}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
