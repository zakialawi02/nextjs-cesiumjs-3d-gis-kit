import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodTypeAny, type z } from "zod";

import { env } from "@/env";
import { clientIpFrom } from "@/server/client-ip";
import { StoragePathError } from "@/server/storage";

/**
 * Helpers for route handlers that return JSON in the shape Laravel used, so the ported
 * frontend keeps working: `{ message }` for errors and `{ message, errors: { field: [..] } }`
 * for validation failures (HTTP 422).
 */

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message?: string,
    public readonly errors?: Record<string, string[]>,
    public readonly headers?: Record<string, string>,
  ) {
    super(message ?? defaultMessage(status));
  }
}

function defaultMessage(status: number): string {
  return (
    {
      400: "Bad Request",
      401: "Unauthenticated.",
      403: "This action is unauthorized.",
      404: "Not Found",
      409: "Conflict",
      410: "Gone",
      419: "Page Expired",
      422: "The given data was invalid.",
      429: "Too Many Attempts.",
    }[status] ?? "Server Error"
  );
}

export function abort(status: number, message?: string): never {
  throw new HttpError(status, message);
}

export function abortIf(condition: unknown, status: number, message?: string): asserts condition is false {
  if (condition) abort(status, message);
}

export function abortUnless(condition: unknown, status: number, message?: string): asserts condition {
  if (!condition) abort(status, message);
}

/** Throws a 422 with Laravel-style `errors`. */
export function validationError(errors: Record<string, string[] | string>): never {
  const normalized = Object.fromEntries(
    Object.entries(errors).map(([field, messages]) => [field, Array.isArray(messages) ? messages : [messages]]),
  );
  const first = Object.values(normalized)[0]?.[0];
  throw new HttpError(422, first ?? defaultMessage(422), normalized);
}

/** Converts zod issues into `{ field: [messages] }`. */
export function zodErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.join(".") || "_";
    (errors[field] ??= []).push(issue.message);
  }
  return errors;
}

/** Parses `data` with `schema` or throws a 422. */
export function validate<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) validationError(zodErrors(result.error));
  return result.data;
}

export function json(data: unknown, init?: number | ResponseInit): NextResponse {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

/** Reads a JSON body (or form data) into a plain object; invalid JSON becomes a 400. */
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  const text = await request.text();
  if (text.trim() === "") return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    abort(400, "Malformed JSON body.");
  }
}

export function clientIp(request: Request): string {
  return clientIpFrom((name) => request.headers.get(name));
}

/**
 * CSRF protection for cookie-authenticated, state-changing route handlers: the request must come
 * from this application's origin (Origin header, or Sec-Fetch-Site for same-origin requests).
 * Server Actions already get this check from Next.js.
 */
export function assertSameOrigin(request: NextRequest | Request): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

  const origin = request.headers.get("origin");
  if (origin) {
    const requestOrigin = new URL(request.url).origin;
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    const allowed = new Set(
      [requestOrigin, host ? `${proto}://${host}` : null, env.APP_URL.replace(/\/$/, "")].filter(Boolean),
    );
    if (allowed.has(origin)) return;
    abort(419, "CSRF token mismatch.");
  }

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === null || fetchSite === "same-origin" || fetchSite === "none") return;
  abort(419, "CSRF token mismatch.");
}

type RouteContext<P> = { params: Promise<P> };

/**
 * Wraps a route handler: same-origin check for mutations, and HttpError / ZodError / unexpected
 * errors turned into JSON responses.
 */
export function handler<P = Record<string, string>>(
  fn: (request: NextRequest, context: RouteContext<P>) => Promise<Response> | Response,
) {
  return async (request: NextRequest, context: RouteContext<P>): Promise<Response> => {
    try {
      assertSameOrigin(request);
      return await fn(request, context);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return NextResponse.json(
      error.errors ? { message: error.message, errors: error.errors } : { message: error.message },
      { status: error.status, headers: error.headers },
    );
  }
  if (error instanceof ZodError) {
    const errors = zodErrors(error);
    return NextResponse.json({ message: Object.values(errors)[0]?.[0] ?? defaultMessage(422), errors }, { status: 422 });
  }
  if (error instanceof StoragePathError) {
    return NextResponse.json({ message: "Not Found" }, { status: 404 });
  }
  console.error(error);
  return NextResponse.json(
    { message: process.env.NODE_ENV === "production" ? "Server Error" : String((error as Error)?.message ?? error) },
    { status: 500 },
  );
}
