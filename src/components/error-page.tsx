import { CircleAlert, Globe, Lock, MapPin, Wrench, type LucideIcon } from "lucide-react";
import Link from "next/link";

const COPY: Record<403 | 404 | 500 | 503, { title: string; description: string; icon: LucideIcon }> = {
  403: { title: "403: Forbidden", description: "Sorry, you are forbidden from accessing this page.", icon: Lock },
  404: { title: "404: Page Not Found", description: "Sorry, the page you are looking for could not be found.", icon: MapPin },
  500: { title: "500: Server Error", description: "Whoops, something went wrong on our servers.", icon: CircleAlert },
  503: { title: "503: Service Unavailable", description: "Sorry, we are doing some maintenance. Please check back soon.", icon: Wrench },
};

export function ErrorPage({ status }: { status: 403 | 404 | 500 | 503 }) {
  const { title, description, icon: Icon } = COPY[status];

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 font-sans text-foreground">
      <div className="w-full max-w-lg space-y-6 rounded-md border border-border bg-neutral p-8 text-center">
        <div className="inline-flex h-20 w-20 items-center justify-center rounded-full border border-border bg-muted">
          <Icon className="size-9 text-foreground" aria-hidden="true" />
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight">{title}</h1>
          <p className="text-foreground/70">{description}</p>
        </div>
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          <Globe className="size-4" aria-hidden="true" />
          Back to the map
        </Link>
      </div>
    </div>
  );
}
