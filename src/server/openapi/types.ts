/**
 * The subset of the OpenAPI 3.1 document model used by src/server/openapi/spec.ts. Hand-written so
 * the spec stays typed without adding a dependency; `x-` extensions are allowed where OpenAPI does.
 */

type Extensions = { [key: `x-${string}`]: unknown };

export type Reference = { $ref: string; summary?: string; description?: string };

/** JSON Schema 2020-12 as used by OpenAPI 3.1 (only the keywords this spec needs). */
export type SchemaObject = Extensions & {
  $ref?: string;
  title?: string;
  description?: string;
  type?: JsonType | JsonType[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  examples?: unknown[];
  deprecated?: boolean;
  readOnly?: boolean;
  writeOnly?: boolean;
  // strings
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  contentMediaType?: string;
  contentEncoding?: string;
  // numbers
  minimum?: number;
  maximum?: number;
  // arrays
  items?: SchemaObject;
  prefixItems?: SchemaObject[];
  minItems?: number;
  maxItems?: number;
  // objects
  properties?: Record<string, SchemaObject>;
  required?: string[];
  additionalProperties?: boolean | SchemaObject;
  propertyNames?: SchemaObject;
  minProperties?: number;
  maxProperties?: number;
  // composition
  allOf?: SchemaObject[];
  anyOf?: SchemaObject[];
  oneOf?: SchemaObject[];
  not?: SchemaObject;
};

export type JsonType = "string" | "number" | "integer" | "boolean" | "object" | "array" | "null";

export type ExampleObject = Extensions & {
  summary?: string;
  description?: string;
  value?: unknown;
  externalValue?: string;
};

export type HeaderObject = Extensions & {
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  schema?: SchemaObject;
  example?: unknown;
};

export type EncodingObject = Extensions & {
  contentType?: string;
  headers?: Record<string, HeaderObject | Reference>;
};

export type MediaTypeObject = Extensions & {
  schema?: SchemaObject;
  example?: unknown;
  examples?: Record<string, ExampleObject | Reference>;
  encoding?: Record<string, EncodingObject>;
};

export type ParameterObject = Extensions & {
  name: string;
  in: "query" | "header" | "path" | "cookie";
  description?: string;
  required?: boolean;
  deprecated?: boolean;
  allowEmptyValue?: boolean;
  style?: string;
  explode?: boolean;
  schema?: SchemaObject;
  example?: unknown;
  examples?: Record<string, ExampleObject | Reference>;
};

export type RequestBodyObject = Extensions & {
  description?: string;
  required?: boolean;
  content: Record<string, MediaTypeObject>;
};

export type ResponseObject = Extensions & {
  description: string;
  headers?: Record<string, HeaderObject | Reference>;
  content?: Record<string, MediaTypeObject>;
};

export type ResponsesObject = Record<string, ResponseObject | Reference>;

export type SecurityRequirement = Record<string, string[]>;

export type OperationObject = Extensions & {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId: string;
  parameters?: Array<ParameterObject | Reference>;
  requestBody?: RequestBodyObject | Reference;
  responses: ResponsesObject;
  deprecated?: boolean;
  security?: SecurityRequirement[];
};

export type HttpMethod = "get" | "put" | "post" | "delete" | "options" | "head" | "patch" | "trace";

export type PathItemObject = Extensions & {
  summary?: string;
  description?: string;
  parameters?: Array<ParameterObject | Reference>;
} & Partial<Record<HttpMethod, OperationObject>>;

export type SecuritySchemeObject = Extensions &
  (
    | { type: "apiKey"; description?: string; name: string; in: "query" | "header" | "cookie" }
    | { type: "http"; description?: string; scheme: string; bearerFormat?: string }
  );

export type TagObject = Extensions & {
  name: string;
  description?: string;
  externalDocs?: { url: string; description?: string };
};

export type ComponentsObject = Extensions & {
  schemas?: Record<string, SchemaObject>;
  responses?: Record<string, ResponseObject>;
  parameters?: Record<string, ParameterObject>;
  examples?: Record<string, ExampleObject>;
  requestBodies?: Record<string, RequestBodyObject>;
  headers?: Record<string, HeaderObject>;
  securitySchemes?: Record<string, SecuritySchemeObject>;
};

export type OpenApiDocument = Extensions & {
  openapi: "3.1.0" | "3.1.1";
  jsonSchemaDialect?: string;
  info: Extensions & {
    title: string;
    version: string;
    summary?: string;
    description?: string;
    license?: { name: string; identifier?: string; url?: string };
    contact?: { name?: string; url?: string; email?: string };
  };
  servers?: Array<{ url: string; description?: string }>;
  paths: Record<string, PathItemObject>;
  components?: ComponentsObject;
  security?: SecurityRequirement[];
  tags?: TagObject[];
  externalDocs?: { url: string; description?: string };
};
