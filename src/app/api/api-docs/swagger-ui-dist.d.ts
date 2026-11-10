/** Minimal typings for the bundled Swagger UI build of swagger-ui-dist (no @types package installed). */
declare module "swagger-ui-dist/swagger-ui-es-bundle.js" {
  type SwaggerRequest = { url: string; credentials?: RequestCredentials; headers: Record<string, string> };

  export type SwaggerUIOptions = {
    url?: string;
    domNode?: HTMLElement;
    dom_id?: string;
    deepLinking?: boolean;
    docExpansion?: "list" | "full" | "none";
    defaultModelsExpandDepth?: number;
    displayRequestDuration?: boolean;
    filter?: boolean | string;
    persistAuthorization?: boolean;
    tryItOutEnabled?: boolean;
    withCredentials?: boolean;
    showExtensions?: boolean;
    showCommonExtensions?: boolean;
    syntaxHighlight?: false | { activated?: boolean; theme?: string };
    requestInterceptor?: (request: SwaggerRequest) => SwaggerRequest;
    onComplete?: () => void;
    [option: string]: unknown;
  };

  export type SwaggerUIInstance = { [key: string]: unknown };

  const SwaggerUI: (options: SwaggerUIOptions) => SwaggerUIInstance;
  export default SwaggerUI;
}
