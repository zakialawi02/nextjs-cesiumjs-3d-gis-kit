import "@fontsource-variable/exo-2";
import "./globals.css";

import type { Metadata, Viewport } from "next";
import Script from "next/script";
import NextTopLoader from "nextjs-toploader";
import { Suspense } from "react";

import { ClientBootstrap } from "@/components/client-bootstrap";
import { geodataConfig } from "@/config/geodata";
import { env } from "@/env";
import { THEME_INIT_SCRIPT } from "@/lib/theme-script";

import { Providers } from "./providers";

export const metadata: Metadata = {
  title: {
    template: `%s • ${env.APP_NAME}`,
    default: env.APP_NAME,
  },
  description: "3D WebGIS starter kit: upload elevation models, orthophotos and vector data and explore them on a CesiumJS globe.",
  robots: { index: false, follow: false },
  icons: {
    icon: [{ url: "/assets/img/webgis-logo.svg", type: "image/svg+xml" }, { url: "/favicon.ico" }],
    apple: "/assets/img/apple-touch-icon.png",
  },
  openGraph: {
    title: env.APP_NAME,
    description: env.APP_NAME,
    images: ["/assets/img/webgis-icon.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a100e",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Stored light/dark choice (applied before paint), UTM settings (config/geodata.ts) and Cesium's
  // static asset folder for the vanilla map scripts.
  const bootScript = `${THEME_INIT_SCRIPT}window.APP_GIS_CONFIG=${JSON.stringify(geodataConfig.utm)};window.CESIUM_BASE_URL="/cesium/";`;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* beforeInteractive inline scripts are emitted in the initial <head> HTML and run before paint. */}
        <Script id="app-boot" strategy="beforeInteractive">
          {bootScript}
        </Script>
      </head>
      <body className="bg-background text-foreground font-sans antialiased">
        <NextTopLoader color="#047857" showSpinner={false} />
        <Providers>{children}</Providers>
        <div className="fixed end-4 top-8 z-[200] flex flex-col space-y-2" id="zk-toast-container"></div>
        <Suspense fallback={null}>
          <ClientBootstrap />
        </Suspense>
      </body>
    </html>
  );
}
