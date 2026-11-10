import type {
  ExampleObject,
  HeaderObject,
  MediaTypeObject,
  ParameterObject,
  Reference,
  ResponseObject,
  SchemaObject,
} from "./types";

/** `$ref` helpers for the reusable parts under `components`. */
export const schemaRef = (name: string): SchemaObject => ({ $ref: `#/components/schemas/${name}` });
export const responseRef = (name: string): Reference => ({ $ref: `#/components/responses/${name}` });
export const parameterRef = (name: string): Reference => ({ $ref: `#/components/parameters/${name}` });
export const headerRef = (name: string): Reference => ({ $ref: `#/components/headers/${name}` });

/** `schema` or JSON null. */
export function nullable(schema: SchemaObject): SchemaObject {
  return { anyOf: [schema, { type: "null" }] };
}

type Examples = Record<string, ExampleObject>;

/** An `application/json` media type with optional named examples. */
export function jsonContent(schema: SchemaObject, examples?: Examples): Record<string, MediaTypeObject> {
  return { "application/json": examples ? { schema, examples } : { schema } };
}

/** A JSON response. */
export function jsonResponse(
  description: string,
  schema: SchemaObject,
  examples?: Examples,
  headers?: Record<string, HeaderObject | Reference>,
): ResponseObject {
  return { description, ...(headers ? { headers } : {}), content: jsonContent(schema, examples) };
}

/** A `{ message }` error response with one example per message the endpoint can return. */
export function errorResponse(description: string, messages: Record<string, string>, headers?: Record<string, HeaderObject | Reference>): ResponseObject {
  const examples = Object.fromEntries(
    Object.entries(messages).map(([name, message]) => [name, { summary: message, value: { message } }]),
  );
  return jsonResponse(description, schemaRef("Error"), examples, headers);
}

/** A 422 response with Laravel-style `{ message, errors }` examples. */
export function validationResponse(examples: Record<string, { summary?: string; errors: Record<string, string[]> }>): ResponseObject {
  return jsonResponse(
    "Validation failed. `message` repeats the first error; `errors` maps each invalid field to its messages.",
    schemaRef("ValidationError"),
    Object.fromEntries(
      Object.entries(examples).map(([name, { summary, errors }]) => {
        const message = Object.values(errors)[0]?.[0] ?? "The given data was invalid.";
        return [name, { summary: summary ?? message, value: { message, errors } }];
      }),
    ),
  );
}

/** A required path parameter. */
export function pathParameter(name: string, description: string, schema: SchemaObject, example?: unknown): ParameterObject {
  return { name, in: "path", required: true, description, schema, ...(example !== undefined ? { example } : {}) };
}

/** Human-readable size: 2097152 → "2 MB", 1536 → "1.5 KB". */
export function formatSize(bytes: number): string {
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Number.isInteger(value) ? value : value.toFixed(1)} ${units[unit]}`;
}
