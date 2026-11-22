import { Hono } from 'hono';
import {
  BadRequestException,
  type ModuleImport,
  type ParamDefinition,
  type ResponseHandle
} from '@drogonjs/common';
import {
  ApplicationContext,
  createHttpHost,
  createRoutes,
  firstForwardedIp,
  parseCookies,
  resolveCors,
  type CorsOptions,
  type PlatformBinding,
  type RouterOptions
} from '@drogonjs/core';

export interface HonoApplicationOptions extends RouterOptions {
  /** Answers preflight requests and adds CORS headers to every response. */
  cors?: boolean | CorsOptions;
  /**
   * Read `@Ip()` from `X-Forwarded-For`. Enable only behind a proxy that sets
   * the header, since clients can send any value. Defaults to `false`, which
   * reports the socket address where the runtime exposes it.
   */
  trustProxy?: boolean;
  /** Any remaining keys are passed to the `Hono` constructor. */
  [honoOption: string]: unknown;
}

async function readBody(c: any) {
  const contentType = c.req.header('content-type') ?? '';
  try {
    if (contentType.includes('application/json')) return await c.req.json();
    if (contentType.includes('application/x-www-form-urlencoded')) return await c.req.parseBody();
    if (contentType.includes('multipart/form-data')) return await c.req.parseBody();
    if (contentType.includes('text/plain')) return await c.req.text();
  } catch (error) {
    // A malformed payload is a client error, not an unhandled server fault.
    throw new BadRequestException('Malformed request body', { cause: error });
  }
  return undefined;
}

interface RequestState {
  body?: unknown;
  status?: number;
}

const requestState = new WeakMap<object, RequestState>();

function stateOf(c: any): RequestState {
  let state = requestState.get(c);
  if (!state) {
    state = {};
    requestState.set(c, state);
  }
  return state;
}

function responseHandle(c: any): ResponseHandle {
  const handle: ResponseHandle = {
    status(code) {
      stateOf(c).status = code;
      return handle;
    },
    header(name, value) {
      c.header(name, value);
      return handle;
    }
  };
  return handle;
}

/** Bun hands its server to `fetch` as the second argument, which Hono exposes as `c.env`. */
function socketAddress(c: any): string | null {
  try {
    return c.env?.requestIP?.(c.req.raw)?.address ?? null;
  } catch {
    return null;
  }
}

function createBinding(trustProxy: boolean): PlatformBinding<any> {
  return {
    extract(c, param: ParamDefinition) {
      switch (param.type) {
        case 'ctx':
        case 'req':
          return c;
        case 'res':
          return responseHandle(c);
        case 'body': {
          const body: any = stateOf(c).body;
          return param.key ? body?.[param.key] : body;
        }
        case 'query':
          return param.key ? c.req.query(param.key) : c.req.query();
        case 'param':
          return param.key ? c.req.param(param.key) : c.req.param();
        case 'params':
          return c.req.param();
        case 'headers':
          return param.key
            ? c.req.raw.headers.get(param.key) ?? undefined
            : Object.fromEntries(c.req.raw.headers.entries());
        case 'cookie': {
          const cookies = parseCookies(c.req.header('cookie'));
          return param.key ? cookies[param.key] : cookies;
        }
        case 'ip':
          if (trustProxy) {
            const forwarded = firstForwardedIp(c.req.header('x-forwarded-for'));
            if (forwarded) return forwarded;
          }
          return socketAddress(c);
        default:
          return c;
      }
    },
    host(c) {
      return createHttpHost({
        request: () => c.req.raw,
        response: () => responseHandle(c),
        params: () => c.req.param(),
        query: () => c.req.query(),
        headers: () => Object.fromEntries(c.req.raw.headers.entries()),
        body: () => stateOf(c).body
      });
    },
    request(c) {
      return c.req.raw;
    },
    async prepare(c) {
      // Hono caches what it parses, so `c.req.json()` and friends keep working
      // in handlers after this.
      if (c.req.method !== 'GET' && c.req.method !== 'HEAD') stateOf(c).body = await readBody(c);
    }
  };
}

function toResponse(c: any, result: unknown, status?: number) {
  if (result instanceof Response) return result;
  if (result === undefined || result === null) return c.body(null, status ?? 204);
  if (typeof result === 'string') return c.text(result, status ?? 200);
  return c.json(result, status ?? 200);
}

/**
 * Mounts every controller of `root` on a new Hono app. `root` may also be an
 * `ApplicationContext` that already exists, such as a testing module's.
 */
export async function createHonoApplication(root: ModuleImport | ApplicationContext, options: HonoApplicationOptions = {}) {
  const {
    globalGuards,
    globalInterceptors,
    globalPipes,
    globalFilters,
    globalPrefix,
    versioning,
    cors,
    trustProxy = false,
    ...honoOptions
  } = options;
  const application = root instanceof ApplicationContext ? root : await ApplicationContext.create(root);
  const routes = await createRoutes(application, createBinding(trustProxy), {
    globalGuards,
    globalInterceptors,
    globalPipes,
    globalFilters,
    globalPrefix,
    versioning
  });

  const app = new Hono(honoOptions);

  if (cors) {
    const corsOptions = cors === true ? {} : cors;
    app.use('*', async (c, next) => {
      const result = await resolveCors(c.req.raw, corsOptions);
      if (result.preflight) return new Response(null, { status: result.preflight.status, headers: result.headers });
      await next();
      for (const [name, value] of Object.entries(result.headers)) c.res.headers.set(name, value);
    });
  }

  for (const { route, path, controller, handle } of routes) {
    // Hono has no counterpart to Elysia's schema validation. Ignoring the
    // schema would accept input the route was declared to reject.
    if (route.schema) {
      throw new Error(
        `[DrogonJS] ${controller.name}.${String(route.propertyKey)} declares @ApiSchema, which only the ` +
        'Elysia adapter enforces. Validate with a pipe (@UsePipes or a parameter pipe) on Hono.'
      );
    }

    const handler = async (c: any) => {
      const outcome = await handle(c);
      const status = outcome.status ?? stateOf(c).status ?? outcome.defaultStatus;
      return toResponse(c, outcome.value, status);
    };

    switch (route.method) {
      case 'GET':
        app.get(path, handler);
        break;
      case 'POST':
        app.post(path, handler);
        break;
      case 'PUT':
        app.put(path, handler);
        break;
      case 'PATCH':
        app.patch(path, handler);
        break;
      case 'DELETE':
        app.delete(path, handler);
        break;
      case 'OPTIONS':
        app.options(path, handler);
        break;
      case 'ALL':
        app.all(path, handler);
        break;
      default:
        app.on(route.method, path, handler);
    }
  }

  return { app, application };
}
