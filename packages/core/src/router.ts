import {
  ForbiddenException,
  HttpException,
  Logger,
  VERSION_NEUTRAL,
  VersioningType,
  getCatchTypes,
  getControllerEnhancers,
  getControllerMeta,
  getControllerVersion,
  getMethodParamTypes,
  getRouteParams,
  getRoutes,
  tokenName,
  type ArgumentMetadata,
  type CanActivate,
  type Constructor,
  type DrogonInterceptor,
  type DrogonMiddleware,
  type ExceptionFilter,
  type ExecutionContext,
  type FunctionMiddleware,
  type HttpArgumentsHost,
  type MiddlewareConfiguration,
  type ParamDefinition,
  type ParamType,
  type PipeTransform,
  type ResponseHandle,
  type RouteDefinition,
  type RouteInfo,
  type Token,
  type VersioningOptions,
  type VersionValue
} from '@drogonjs/common';
import type { AppEnhancerKind, ApplicationContext } from './application-context';
import { ContextId, type Container } from './container';
import { MiddlewareBuilder, middlewareApplies, routeInfoMatches, type RouteTarget } from './middleware';

/** Enhancers applied to every route, ahead of controller- and method-level ones. */
export interface GlobalEnhancers {
  globalGuards?: unknown[];
  globalInterceptors?: unknown[];
  globalPipes?: unknown[];
  globalFilters?: unknown[];
}

export interface GlobalPrefixOptions {
  prefix: string;
  /** Routes served without the prefix, as path patterns or `{ path, method }`. */
  exclude?: Array<string | RouteInfo>;
}

export interface RouterOptions extends GlobalEnhancers {
  globalPrefix?: string | GlobalPrefixOptions;
  versioning?: VersioningOptions;
}

/** What an HTTP adapter supplies so the shared pipeline can run on its context type. */
export interface PlatformBinding<C> {
  /** The value for a parameter decorator, before any pipe runs. */
  extract(ctx: C, param: ParamDefinition): unknown | Promise<unknown>;
  /** The HTTP view handed to guards, interceptors and filters. */
  host(ctx: C): HttpArgumentsHost;
  /**
   * The Fetch `Request`. Injected as `REQUEST`, returned by `getRequest()` and
   * passed to middleware.
   */
  request(ctx: C): unknown;
  /**
   * Runs before middleware and guards, inside the exception filters. Adapters
   * use it to parse the body so guards and `getBody()` see it on every platform.
   */
  prepare?(ctx: C): void | Promise<void>;
}

/** The value to send, and how to choose its status. */
export interface RouteOutcome {
  value: unknown;
  /**
   * Set when the value came from an exception or a redirect. Takes precedence
   * over a status chosen through `@Res()`.
   */
  status?: number;
  /** The route's `@HttpCode`, which a status chosen through `@Res()` overrides. */
  defaultStatus?: number;
}

export interface MountedRoute<C> {
  route: RouteDefinition;
  path: string;
  controller: Constructor;
  handle(ctx: C): Promise<RouteOutcome>;
}

interface Enhancer {
  item: unknown;
  container: Container;
  /** Resolve this token instead of treating `item` as a class or instance. */
  token?: Token;
  /** Middleware may also be a plain function, which is called rather than built. */
  middleware?: boolean;
}

interface ResolvedEnhancers {
  controller: Record<string | symbol, (...args: unknown[]) => unknown>;
  middleware: Array<DrogonMiddleware | FunctionMiddleware>;
  guards: CanActivate[];
  interceptors: DrogonInterceptor[];
  pipes: PipeTransform[];
  filters: ExceptionFilter[];
  paramPipes: PipeTransform[][];
}

/** Parameters that controller-, method- and global-level pipes apply to. */
const PIPED_PARAMS = new Set<ParamType>(['body', 'query', 'param', 'params']);

const exceptionsLogger = new Logger('ExceptionsHandler');

type VersionEntry = string | typeof VERSION_NEUTRAL;

export function joinPaths(...parts: string[]) {
  const cleaned = parts
    .filter(Boolean)
    .map((part, index) => {
      if (index === 0) return part === '/' ? '' : part.replace(/\/$/, '');
      return part.replace(/^\//, '').replace(/\/$/, '');
    })
    .filter(Boolean);

  const path = '/' + cleaned.join('/');
  return path === '//' ? '/' : path.replace(/\/+/g, '/');
}

/** Builds an `HttpArgumentsHost` from plain getters, so adapters need no generic casts. */
export function createHttpHost(parts: {
  request: () => unknown;
  response: () => unknown;
  params: () => unknown;
  query: () => unknown;
  headers: () => unknown;
  body: () => unknown;
}): HttpArgumentsHost {
  return {
    getRequest: <T>() => parts.request() as T,
    getResponse: <T>() => parts.response() as T,
    getParams: <T>() => parts.params() as T,
    getQuery: <T>() => parts.query() as T,
    getHeaders: <T>() => parts.headers() as T,
    getBody: <T>() => parts.body() as T
  };
}

/** Parses a `Cookie` header into name/value pairs, decoding percent escapes. */
export function parseCookies(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    if (!name || name in cookies) continue;
    let value = pair.slice(separator + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

/** `x-forwarded-for` is a comma-separated chain; the client is the first entry. */
export function firstForwardedIp(header: string | null | undefined): string | null {
  if (!header) return null;
  const first = header.split(',')[0]?.trim();
  return first ? first : null;
}

/**
 * Builds a platform-independent handler for every route in the application.
 * Each handler runs middleware, guards, then interceptors around pipes and the
 * route method, with exception filters wrapping the whole chain.
 */
export async function createRoutes<C>(
  application: ApplicationContext,
  binding: PlatformBinding<C>,
  options: RouterOptions = {}
): Promise<MountedRoute<C>[]> {
  const candidates: Array<MountedRoute<C> & { versions: VersionEntry[] }> = [];
  const rootContainer = application.container;
  const versioning = options.versioning;
  const prefix = typeof options.globalPrefix === 'string' ? { prefix: options.globalPrefix } : options.globalPrefix;
  const middlewareConfigs = await collectMiddleware(application);

  const substitute = (enhancer: Enhancer): Enhancer => {
    const override = application.getEnhancerOverride(enhancer.item);
    if (!override) return enhancer;
    if ('useValue' in override) return { item: override.useValue, container: enhancer.container };
    if ('useClass' in override) return { item: override.useClass, container: enhancer.container };
    const token = Symbol(`override:${tokenName(enhancer.item as Token)}`);
    rootContainer.register({ provide: token, useFactory: override.useFactory, inject: override.inject ?? [] });
    return { item: enhancer.item, container: rootContainer, token };
  };
  const appEnhancers = (kind: AppEnhancerKind): Enhancer[] =>
    application.getAppEnhancers(kind).map(({ token, container }) => ({ item: token, container, token }));
  const global = (items: unknown[] = []): Enhancer[] =>
    items.map(item => substitute({ item, container: rootContainer }));

  for (const { type, container } of application.getControllers()) {
    const controllerMeta = getControllerMeta(type);
    const controllerEnhancers = getControllerEnhancers(type);
    const controllerVersion = getControllerVersion(type);
    const local = (items: unknown[] = []): Enhancer[] => items.map(item => substitute({ item, container }));

    for (const route of getRoutes(type)) {
      const routePath = joinPaths(controllerMeta.path, route.path);
      const target: RouteTarget = { path: routePath, method: route.method, controller: type };

      // Decorators register right to left; pipes run in argument order.
      const params = [...getRouteParams(type, route.propertyKey)].sort((a, b) => a.index - b.index);
      const argCount = params.length ? Math.max(...params.map(param => param.index)) + 1 : 0;
      const metatypes = getMethodParamTypes(type, route.propertyKey);

      const middleware = middlewareConfigs
        .filter(({ config }) => middlewareApplies(config, target))
        .flatMap(({ config, container: owner }) =>
          config.middleware.map((item): Enhancer => ({ item, container: owner, middleware: true }))
        );
      const guards = [
        ...global(options.globalGuards),
        ...appEnhancers('guard'),
        ...local(controllerEnhancers.guards),
        ...local(route.guards)
      ];
      const interceptors = [
        ...global(options.globalInterceptors),
        ...appEnhancers('interceptor'),
        ...local(controllerEnhancers.interceptors),
        ...local(route.interceptors)
      ];
      const pipes = [
        ...global(options.globalPipes),
        ...appEnhancers('pipe'),
        ...local(controllerEnhancers.pipes),
        ...local(route.pipes)
      ];
      // Closest first: the first filter whose @Catch matches handles the exception.
      const filters = [
        ...local(route.filters),
        ...local(controllerEnhancers.filters),
        ...appEnhancers('filter'),
        ...global(options.globalFilters)
      ];
      const paramPipes = params.map(param => local(param.pipes));

      const all = [...middleware, ...guards, ...interceptors, ...pipes, ...filters, ...paramPipes.flat()];
      for (const enhancer of all) {
        // An enhancer class nobody registered is built by the container of the
        // module that uses it, so its own dependencies resolve as usual.
        if (isClassEnhancer(enhancer) && !enhancer.container.has(enhancer.item)) enhancer.container.register(enhancer.item);
      }

      const requestScoped =
        container.isRequestScoped(type) ||
        all.some(enhancer =>
          enhancer.token
            ? enhancer.container.isRequestScoped(enhancer.token)
            : isClassEnhancer(enhancer) && enhancer.container.isRequestScoped(enhancer.item)
        );

      const resolveAll = async (contextId?: ContextId): Promise<ResolvedEnhancers> => {
        const resolve = async (enhancer: Enhancer) => {
          if (enhancer.token) return enhancer.container.resolve(enhancer.token, contextId);
          return isClassEnhancer(enhancer) ? enhancer.container.resolve(enhancer.item, contextId) : enhancer.item;
        };
        const resolveList = (list: Enhancer[]) => Promise.all(list.map(resolve));

        const [controller, m, g, i, p, f, pp] = await Promise.all([
          container.resolve(type, contextId),
          resolveList(middleware),
          resolveList(guards),
          resolveList(interceptors),
          resolveList(pipes),
          resolveList(filters),
          Promise.all(paramPipes.map(resolveList))
        ]);
        return {
          controller,
          middleware: m as ResolvedEnhancers['middleware'],
          guards: assertEach(g, 'canActivate', 'guard'),
          interceptors: assertEach(i, 'intercept', 'interceptor'),
          pipes: assertEach(p, 'transform', 'pipe'),
          filters: assertEach(f, 'catch', 'exception filter'),
          paramPipes: pp.map(list => assertEach(list, 'transform', 'pipe'))
        };
      };

      // Resolved once at mount time unless something in the chain is
      // request-scoped, in which case every request gets its own instances.
      const staticEnhancers = requestScoped ? undefined : await resolveAll();
      const handlerRef = type.prototype[route.propertyKey as keyof typeof type.prototype] as Function;

      const handle = async (ctx: C): Promise<RouteOutcome> => {
        const context = createExecutionContext(type, handlerRef, binding, ctx);
        let filterChain: ExceptionFilter[] = staticEnhancers?.filters ?? [];
        try {
          await binding.prepare?.(ctx);
          const resolved = staticEnhancers ?? (await resolveAll(new ContextId(binding.request(ctx))));
          filterChain = resolved.filters;

          const shortCircuit = await runMiddleware(resolved.middleware, binding, ctx);
          if (shortCircuit) return shortCircuit;

          for (const guard of resolved.guards) {
            if (!(await guard.canActivate(context))) throw new ForbiddenException('Forbidden resource');
          }

          const invoke = async () => {
            const args = await buildArgs(ctx, binding, params, argCount, metatypes, resolved, context);
            if (route.headers) {
              const response = binding.host(ctx).getResponse<ResponseHandle>();
              for (const [name, value] of Object.entries(route.headers)) response.header(name, value);
            }
            return resolved.controller[route.propertyKey as string]!(...args);
          };

          let next: () => Promise<unknown> = invoke;
          for (const interceptor of [...resolved.interceptors].reverse()) {
            const inner = next;
            next = async () => interceptor.intercept(context, { handle: inner });
          }

          const value = await next();
          if (route.redirect) return redirect(route.redirect, value, binding, ctx);
          return { value, defaultStatus: route.statusCode };
        } catch (error) {
          return handleException(error, filterChain, context);
        }
      };

      const versions: VersionEntry[] = versioning
        ? normalizeVersions(route.version ?? controllerVersion ?? versioning.defaultVersion)
        : [VERSION_NEUTRAL];
      const prefixed = prefix && !prefix.exclude?.some(info => routeInfoMatches(info, target)) ? prefix.prefix : '';

      if (versioning?.type === VersioningType.URI) {
        const uriPrefix = versioning.prefix === false ? '' : (versioning.prefix ?? 'v');
        for (const version of versions) {
          const segment = typeof version === 'string' ? `${uriPrefix}${version}` : '';
          candidates.push({ route, path: joinPaths(prefixed, segment, routePath), controller: type, handle, versions: [version] });
        }
      } else {
        candidates.push({ route, path: joinPaths(prefixed, routePath), controller: type, handle, versions });
      }
    }
  }

  if (!versioning || versioning.type === VersioningType.URI) return candidates;
  return groupByVersion(candidates, versioning, binding);
}

/** Calls every module's `configure(consumer)`, imports first. */
async function collectMiddleware(application: ApplicationContext) {
  const configs: Array<{ config: MiddlewareConfiguration; container: Container }> = [];
  for (const { module, container } of application.getModules()) {
    const instance = (await container.resolve(module.type)) as { configure?: (consumer: MiddlewareBuilder) => void };
    if (typeof instance?.configure !== 'function') continue;
    const builder = new MiddlewareBuilder();
    instance.configure(builder);
    for (const config of builder.configurations) configs.push({ config, container });
  }
  return configs;
}

/** Runs middleware in order; a value returned without calling `next` answers the request. */
async function runMiddleware<C>(
  middleware: ResolvedEnhancers['middleware'],
  binding: PlatformBinding<C>,
  ctx: C
): Promise<RouteOutcome | undefined> {
  if (!middleware.length) return undefined;
  const request = binding.request(ctx) as Request;
  const response = binding.host(ctx).getResponse<ResponseHandle>();
  let reachedEnd = false;
  let answer: RouteOutcome | undefined;

  const dispatch = async (index: number): Promise<void> => {
    if (index === middleware.length) {
      reachedEnd = true;
      return;
    }
    const current = middleware[index]!;
    let called = false;
    const next = async () => {
      if (called) throw new Error('[DrogonJS] next() called more than once in a middleware');
      called = true;
      await dispatch(index + 1);
    };
    const result =
      typeof current === 'function' ? await current(request, response, next) : await current.use(request, response, next);
    if (!called && !answer) answer = { value: result };
  };

  await dispatch(0);
  return reachedEnd ? undefined : (answer ?? { value: undefined });
}

function redirect<C>(
  declared: NonNullable<RouteDefinition['redirect']>,
  value: unknown,
  binding: PlatformBinding<C>,
  ctx: C
): RouteOutcome {
  const returned = (typeof value === 'object' && value !== null ? value : {}) as { url?: string; statusCode?: number };
  const url = returned.url ?? declared.url;
  const status = returned.statusCode ?? declared.statusCode;
  binding.host(ctx).getResponse<ResponseHandle>().header('Location', url);
  return { value: null, status };
}

function normalizeVersions(version: VersionValue | undefined): VersionEntry[] {
  if (version === undefined) return [VERSION_NEUTRAL];
  return Array.isArray(version) ? version : [version];
}

function requestedVersions(request: Request, versioning: VersioningOptions): string[] {
  switch (versioning.type) {
    case VersioningType.HEADER: {
      const value = request.headers.get(versioning.header);
      return value ? [value.trim()] : [];
    }
    case VersioningType.MEDIA_TYPE: {
      const accept = request.headers.get('accept') ?? '';
      const part = accept
        .split(/[;,]/)
        .map(piece => piece.trim())
        .find(piece => piece.startsWith(versioning.key));
      return part ? [part.slice(versioning.key.length)] : [];
    }
    case VersioningType.CUSTOM: {
      const value = versioning.extractor(request);
      if (value === undefined) return [];
      return Array.isArray(value) ? value : [value];
    }
    default:
      return [];
  }
}

/**
 * Header, media-type and custom versioning serve every version from one path,
 * so routes sharing a method and path become one handler that dispatches on
 * the version the request names.
 */
function groupByVersion<C>(
  candidates: Array<MountedRoute<C> & { versions: VersionEntry[] }>,
  versioning: VersioningOptions,
  binding: PlatformBinding<C>
): MountedRoute<C>[] {
  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const key = `${candidate.route.method} ${candidate.path}`;
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  return [...groups.values()].map(group => {
    if (group.length === 1 && group[0]!.versions.includes(VERSION_NEUTRAL)) return group[0]!;
    if (group.length > 1 && group.some(candidate => candidate.route.schema)) {
      throw new Error(
        `[DrogonJS] ${group[0]!.route.method} ${group[0]!.path} has several versions and an @ApiSchema; ` +
        'schemas cannot differ per version on one path. Validate with pipes instead.'
      );
    }

    const handle = async (ctx: C): Promise<RouteOutcome> => {
      const requested = requestedVersions(binding.request(ctx) as Request, versioning);
      const chosen =
        requested.map(version => group.find(candidate => candidate.versions.includes(version))).find(Boolean) ??
        group.find(candidate => candidate.versions.includes(VERSION_NEUTRAL));
      if (!chosen) {
        const { method } = group[0]!.route;
        return {
          value: { statusCode: 404, message: `Cannot ${method} ${group[0]!.path}`, error: 'Not Found' },
          status: 404
        };
      }
      return chosen.handle(ctx);
    };

    return { route: group[0]!.route, path: group[0]!.path, controller: group[0]!.controller, handle };
  });
}

/** Classes are built by the container; instances and functional middleware are used as they are. */
function isClassEnhancer(enhancer: Enhancer): enhancer is Enhancer & { item: Constructor } {
  if (enhancer.token || typeof enhancer.item !== 'function') return false;
  return !enhancer.middleware || typeof enhancer.item.prototype?.use === 'function';
}

async function buildArgs<C>(
  ctx: C,
  binding: PlatformBinding<C>,
  params: ParamDefinition[],
  argCount: number,
  metatypes: unknown[],
  resolved: ResolvedEnhancers,
  context: ExecutionContext
): Promise<unknown[]> {
  // A handler without parameter decorators receives the native context.
  if (!params.length) return [ctx];
  const args = new Array(argCount).fill(undefined);

  for (const [position, param] of params.entries()) {
    let value = param.type === 'custom' ? await param.factory!(param.data, context) : await binding.extract(ctx, param);
    const pipes = [...(PIPED_PARAMS.has(param.type) ? resolved.pipes : []), ...resolved.paramPipes[position]!];
    if (pipes.length) {
      const metadata: ArgumentMetadata = {
        type: argumentType(param.type),
        metatype: metatypes[param.index] as ArgumentMetadata['metatype'],
        data: param.key
      };
      for (const pipe of pipes) value = await pipe.transform(value, metadata);
    }
    args[param.index] = value;
  }

  return args;
}

function argumentType(type: ParamType): ArgumentMetadata['type'] {
  if (type === 'body' || type === 'query') return type;
  if (type === 'param' || type === 'params') return 'param';
  return 'custom';
}

async function handleException(error: unknown, filters: ExceptionFilter[], context: ExecutionContext): Promise<RouteOutcome> {
  const filter = filters.find(candidate => {
    const types = getCatchTypes(candidate.constructor as Constructor);
    return !types.length || types.some(type => error instanceof type);
  });

  if (filter) {
    try {
      const value = await filter.catch(error, context);
      return { value, status: HttpException.isHttpException(error) ? error.status : 500 };
    } catch (filterError) {
      error = filterError;
    }
  }

  if (HttpException.isHttpException(error)) return { value: error.toJSON(), status: error.status };
  exceptionsLogger.error(error);
  return { value: { statusCode: 500, message: 'Internal server error' }, status: 500 };
}

function createExecutionContext<C>(type: Constructor, handler: Function, binding: PlatformBinding<C>, ctx: C): ExecutionContext {
  let host: HttpArgumentsHost | undefined;
  return {
    getType: <T extends string>() => 'http' as T,
    getClass: <T>() => type as T,
    getHandler: () => handler,
    switchToHttp: () => (host ??= binding.host(ctx)),
    getArgs: <T extends unknown[]>() => [ctx] as T,
    getArgByIndex: <T>(index: number) => [ctx][index] as unknown as T
  };
}

function assertEach<T>(items: unknown[], method: string, role: string): T[] {
  for (const item of items) {
    if (typeof (item as Record<string, unknown>)?.[method] !== 'function') {
      const name = typeof item === 'object' && item !== null ? item.constructor.name : tokenName(item as never);
      throw new Error(`[DrogonJS] ${name} is used as a ${role} but has no ${method}() method`);
    }
  }
  return items as T[];
}
