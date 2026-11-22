import { Elysia } from 'elysia';
import type { ModuleImport, ParamDefinition, ResponseHandle } from '@drogonjs/common';
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

export interface ElysiaApplicationOptions extends RouterOptions {
  /** Answers preflight requests and adds CORS headers to every response. */
  cors?: boolean | CorsOptions;
  /**
   * Read `@Ip()` from `X-Forwarded-For`. Enable only behind a proxy that sets
   * the header, since clients can send any value. Defaults to `false`, which
   * reports the socket address.
   */
  trustProxy?: boolean;
  /** Any remaining keys are passed to the `Elysia` constructor. */
  [elysiaOption: string]: unknown;
}

/** Per-request bookkeeping for the `@Res()` handle. */
const explicitStatus = new WeakMap<object, number>();

function responseHandle(ctx: any): ResponseHandle {
  const handle: ResponseHandle = {
    status(code) {
      ctx.set.status = code;
      explicitStatus.set(ctx, code);
      return handle;
    },
    header(name, value) {
      ctx.set.headers[name] = value;
      return handle;
    }
  };
  return handle;
}

function createBinding(trustProxy: boolean): PlatformBinding<any> {
  return {
    extract(ctx, param: ParamDefinition) {
      switch (param.type) {
        case 'ctx':
        case 'req':
          return ctx;
        case 'res':
          return responseHandle(ctx);
        case 'body':
          return param.key ? ctx.body?.[param.key] : ctx.body;
        case 'query':
          return param.key ? ctx.query?.[param.key] : ctx.query;
        case 'param':
          return param.key ? ctx.params?.[param.key] : ctx.params;
        case 'params':
          return ctx.params;
        case 'headers':
          return param.key
            ? ctx.request.headers.get(param.key) ?? undefined
            : Object.fromEntries(ctx.request.headers.entries());
        case 'cookie': {
          const cookies = parseCookies(ctx.request.headers.get('cookie'));
          return param.key ? cookies[param.key] : cookies;
        }
        case 'ip':
          if (trustProxy) {
            const forwarded = firstForwardedIp(ctx.request.headers.get('x-forwarded-for'));
            if (forwarded) return forwarded;
          }
          return ctx.server?.requestIP(ctx.request)?.address ?? null;
        default:
          return ctx;
      }
    },
    host(ctx) {
      return createHttpHost({
        request: () => ctx.request,
        response: () => responseHandle(ctx),
        params: () => ctx.params,
        query: () => ctx.query,
        headers: () => Object.fromEntries(ctx.request.headers.entries()),
        body: () => ctx.body
      });
    },
    request(ctx) {
      return ctx.request;
    }
  };
}

/**
 * Mounts every controller of `root` on a new Elysia app. `root` may also be an
 * `ApplicationContext` that already exists, such as a testing module's.
 */
export async function createElysiaApplication(root: ModuleImport | ApplicationContext, options: ElysiaApplicationOptions = {}) {
  const {
    globalGuards,
    globalInterceptors,
    globalPipes,
    globalFilters,
    globalPrefix,
    versioning,
    cors,
    trustProxy = false,
    ...elysiaOptions
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

  // `aot` stays overridable: handlers are built at runtime, so ahead-of-time
  // compilation is off by default but callers may opt back in.
  let app: any = new Elysia({ aot: false, ...elysiaOptions });

  if (cors) {
    const corsOptions = cors === true ? {} : cors;
    // onRequest runs before routing, so preflights for any path are answered.
    app = app.onRequest(async ({ request, set }: any) => {
      const result = await resolveCors(request, corsOptions);
      if (result.preflight) return new Response(null, { status: result.preflight.status, headers: result.headers });
      Object.assign(set.headers, result.headers);
    });
  }

  for (const { route, path, handle } of routes) {
    const handler = async (ctx: any) => {
      const outcome = await handle(ctx);
      const explicit = explicitStatus.has(ctx);
      if (outcome.status !== undefined) ctx.set.status = outcome.status;
      else if (!explicit && outcome.defaultStatus !== undefined) ctx.set.status = outcome.defaultStatus;

      // An empty result is a 204 unless a status was chosen explicitly, the
      // same as on the Hono adapter.
      if (outcome.value === undefined || outcome.value === null) {
        if (outcome.status === undefined && outcome.defaultStatus === undefined && !explicit) {
          ctx.set.status = 204;
        }
        return new Response(null, { status: Number(ctx.set.status), headers: ctx.set.headers });
      }
      return outcome.value;
    };

    const detail = route.detail ? { detail: route.detail } : {};
    const config = { ...(route.schema ?? {}), ...detail };

    switch (route.method) {
      case 'GET':
        app = app.get(path, handler, config);
        break;
      case 'POST':
        app = app.post(path, handler, config);
        break;
      case 'PUT':
        app = app.put(path, handler, config);
        break;
      case 'PATCH':
        app = app.patch(path, handler, config);
        break;
      case 'DELETE':
        app = app.delete(path, handler, config);
        break;
      case 'OPTIONS':
        app = app.options(path, handler, config);
        break;
      case 'HEAD':
        app = app.head(path, handler, config);
        break;
      case 'ALL':
        app = app.all(path, handler, config);
        break;
    }
  }

  return { app, application };
}
