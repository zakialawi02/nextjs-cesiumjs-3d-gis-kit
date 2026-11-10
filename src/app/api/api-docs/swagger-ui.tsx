"use client";

import "swagger-ui-dist/swagger-ui.css";
import "./api-docs.css";

import { useEffect, useRef, useState } from "react";

type Status = "loading" | "ready" | "error";

/**
 * Swagger UI for the OpenAPI document at `url`. The bundled build (it ships its own React) is
 * loaded on demand, so it never reaches other pages. Requests go out with the session cookie.
 */
export function SwaggerUi({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    import("swagger-ui-dist/swagger-ui-es-bundle.js")
      .then((module) => {
        if (cancelled) return;
        // A CommonJS bundle: `default` is module.exports, which some interop layers wrap once more.
        const exported: unknown = module.default;
        const SwaggerUI = (typeof exported === "function" ? exported : (exported as { default: unknown }).default) as typeof module.default;
        SwaggerUI({
          domNode: container,
          url,
          withCredentials: true,
          persistAuthorization: true,
          tryItOutEnabled: false,
          deepLinking: true,
          docExpansion: "list",
          defaultModelsExpandDepth: 0,
          displayRequestDuration: true,
          filter: true,
          syntaxHighlight: { activated: true, theme: "agate" },
          onComplete: () => {
            if (!cancelled) setStatus("ready");
          },
        });
      })
      .catch((error: unknown) => {
        console.error(error);
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
      container.replaceChildren();
    };
  }, [url]);

  return (
    <div className="api-docs-swagger">
      {status === "loading" ? (
        <p className="px-5 py-10 text-center text-sm text-slate-500" role="status">
          Loading API documentation...
        </p>
      ) : null}
      {status === "error" ? (
        <p className="px-5 py-10 text-center text-sm text-red-600" role="alert">
          Swagger UI could not be loaded. The raw document is available at{" "}
          <a className="underline" href={url}>
            {url}
          </a>
          .
        </p>
      ) : null}
      <div ref={containerRef} />
    </div>
  );
}
