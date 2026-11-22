type StaticOrigin = boolean | string | RegExp | Array<string | RegExp>;

export interface CorsOptions {
  /**
   * Allowed origins. `true` (the default) reflects the request's origin,
   * `'*'` allows any, and a function decides per request.
   */
  origin?: StaticOrigin | ((origin: string | undefined, request: Request) => StaticOrigin | Promise<StaticOrigin>);
  methods?: string | string[];
  /** Defaults to the request's `Access-Control-Request-Headers`. */
  allowedHeaders?: string | string[];
  exposedHeaders?: string | string[];
  credentials?: boolean;
  maxAge?: number;
  /** Status for a successful preflight. Defaults to 204. */
  optionsSuccessStatus?: number;
}

export interface CorsResult {
  headers: Record<string, string>;
  /** Set for a preflight request, which should be answered at once with these headers. */
  preflight?: { status: number };
}

const DEFAULT_METHODS = 'GET,HEAD,PUT,PATCH,POST,DELETE';

/** Computes the CORS response headers for a request, following the `cors` middleware's rules. */
export async function resolveCors(request: Request, options: CorsOptions = {}): Promise<CorsResult> {
  const requestOrigin = request.headers.get('origin') ?? undefined;
  const headers: Record<string, string> = {};
  const configured = options.origin ?? true;
  const origin = typeof configured === 'function' ? await configured(requestOrigin, request) : configured;

  if (origin === '*') {
    headers['Access-Control-Allow-Origin'] = '*';
  } else if (origin !== false && requestOrigin && originAllowed(origin, requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = typeof origin === 'string' ? origin : requestOrigin;
    headers['Vary'] = 'Origin';
  } else if (typeof origin === 'string') {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }

  if (options.credentials) headers['Access-Control-Allow-Credentials'] = 'true';
  if (options.exposedHeaders) headers['Access-Control-Expose-Headers'] = list(options.exposedHeaders);

  const isPreflight = request.method === 'OPTIONS' && request.headers.has('access-control-request-method');
  if (!isPreflight) return { headers };

  headers['Access-Control-Allow-Methods'] = options.methods ? list(options.methods) : DEFAULT_METHODS;
  const allowedHeaders = options.allowedHeaders
    ? list(options.allowedHeaders)
    : request.headers.get('access-control-request-headers');
  if (allowedHeaders) {
    headers['Access-Control-Allow-Headers'] = allowedHeaders;
    if (!options.allowedHeaders) headers['Vary'] = headers['Vary'] ? `${headers['Vary']}, Access-Control-Request-Headers` : 'Access-Control-Request-Headers';
  }
  if (options.maxAge !== undefined) headers['Access-Control-Max-Age'] = String(options.maxAge);
  return { headers, preflight: { status: options.optionsSuccessStatus ?? 204 } };
}

function originAllowed(allowed: StaticOrigin, origin: string): boolean {
  if (allowed === true) return true;
  if (Array.isArray(allowed)) return allowed.some(entry => originAllowed(entry, origin));
  if (allowed instanceof RegExp) return allowed.test(origin);
  return allowed === origin;
}

function list(value: string | string[]) {
  return Array.isArray(value) ? value.join(',') : value;
}
