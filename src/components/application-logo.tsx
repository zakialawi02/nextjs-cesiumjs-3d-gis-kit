/* eslint-disable @next/next/no-img-element -- small static SVG logo, no optimisation needed */

/**
 * App logo (components/application-logo.blade.php). Server components should pass
 * `alt={env.APP_NAME}`; `@/env` cannot be read from client components.
 */
export function ApplicationLogo({ className, alt = "3D WebGIS Core" }: { className?: string; alt?: string }) {
  return <img src="/assets/img/webgis-logo.svg" alt={alt} className={className} />;
}
