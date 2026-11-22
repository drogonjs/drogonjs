import 'reflect-metadata';
import { METADATA_KEYS } from '../metadata-keys';
import { getConstructorChain } from '../reflection';
import type { HttpMethod, RouteDefinition, RouteOptions, VersionValue } from '../route-types';
import type { Constructor } from '../tokens';

interface RouteBag extends RouteOptions {
  method?: HttpMethod;
  path?: string;
}

function getBag(ctor: Constructor, propertyKey: string | symbol): RouteBag {
  return Reflect.getMetadata(METADATA_KEYS.ROUTE_OPTIONS, ctor, propertyKey) ?? {};
}

function saveBag(ctor: Constructor, propertyKey: string | symbol, bag: RouteBag) {
  Reflect.defineMetadata(METADATA_KEYS.ROUTE_OPTIONS, bag, ctor, propertyKey);
}

function getRouteKeys(ctor: Constructor): Set<string | symbol> {
  return Reflect.getOwnMetadata(METADATA_KEYS.ROUTES, ctor) ?? new Set();
}

/** Union of the route keys declared by a controller and every base controller. */
function getInheritedRouteKeys(ctor: Constructor): Set<string | symbol> {
  const keys = new Set<string | symbol>();
  for (const target of getConstructorChain(ctor)) {
    for (const key of getRouteKeys(target)) keys.add(key);
  }
  return keys;
}

function saveRouteKeys(ctor: Constructor, keys: Set<string | symbol>) {
  Reflect.defineMetadata(METADATA_KEYS.ROUTES, keys, ctor);
}

function mergeBag(current: RouteBag, patch: Partial<RouteBag>): RouteBag {
  return {
    ...current,
    ...patch,
    guards: [...(current.guards ?? []), ...(patch.guards ?? [])],
    interceptors: [...(current.interceptors ?? []), ...(patch.interceptors ?? [])],
    pipes: [...(current.pipes ?? []), ...(patch.pipes ?? [])],
    filters: [...(current.filters ?? []), ...(patch.filters ?? [])],
    detail: patch.detail ? { ...(current.detail ?? {}), ...patch.detail } : current.detail,
    headers: patch.headers ? { ...(current.headers ?? {}), ...patch.headers } : current.headers
  };
}

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

function createRouteDecorator(method: HttpMethod) {
  return (path: string = ''): MethodDecorator =>
    (target, propertyKey) => {
      const ctor = target.constructor as Constructor;
      const bag = getBag(ctor, propertyKey!);
      saveBag(ctor, propertyKey!, mergeBag(bag, { method, path: normalizePath(path) }));
      const keys = getRouteKeys(ctor);
      keys.add(propertyKey!);
      saveRouteKeys(ctor, keys);
    };
}

export const Get = createRouteDecorator('GET');
export const Post = createRouteDecorator('POST');
export const Put = createRouteDecorator('PUT');
export const Patch = createRouteDecorator('PATCH');
export const Delete = createRouteDecorator('DELETE');
export const Options = createRouteDecorator('OPTIONS');
export const Head = createRouteDecorator('HEAD');
export const All = createRouteDecorator('ALL');

function patchRouteOption(target: object, propertyKey: string | symbol, patch: Partial<RouteBag>) {
  const ctor = target.constructor as Constructor;
  const bag = getBag(ctor, propertyKey);
  saveBag(ctor, propertyKey, mergeBag(bag, patch));
}

type EnhancerKind = 'guards' | 'interceptors' | 'pipes' | 'filters';

const ENHANCER_KEYS: Record<EnhancerKind, symbol> = {
  guards: METADATA_KEYS.GUARDS,
  interceptors: METADATA_KEYS.INTERCEPTORS,
  pipes: METADATA_KEYS.PIPES,
  filters: METADATA_KEYS.EXCEPTION_FILTERS
};

/** Applies to a single handler on a method, or to every handler on a controller class. */
export type EnhancerDecorator = ClassDecorator & MethodDecorator;

function createEnhancerDecorator(kind: EnhancerKind) {
  return (...items: unknown[]): EnhancerDecorator =>
    ((target: object, propertyKey?: string | symbol) => {
      if (propertyKey === undefined) {
        const existing: unknown[] = Reflect.getOwnMetadata(ENHANCER_KEYS[kind], target) ?? [];
        Reflect.defineMetadata(ENHANCER_KEYS[kind], [...existing, ...items], target);
        return;
      }
      patchRouteOption(target, propertyKey, { [kind]: items });
    }) as EnhancerDecorator;
}

export const UseGuards = createEnhancerDecorator('guards');
export const UseInterceptors = createEnhancerDecorator('interceptors');
export const UsePipes = createEnhancerDecorator('pipes');
export const UseFilters = createEnhancerDecorator('filters');

/**
 * Controller-wide enhancers, from `@Controller({...})` options followed by
 * class-level `@Use*` decorators, base classes before subclasses.
 */
export function getControllerEnhancers(target: Constructor): Required<Pick<RouteOptions, EnhancerKind>> {
  const meta: RouteOptions = Reflect.getMetadata(METADATA_KEYS.CONTROLLER, target) ?? {};
  const result = {
    guards: [...(meta.guards ?? [])],
    interceptors: [...(meta.interceptors ?? [])],
    pipes: [...(meta.pipes ?? [])],
    filters: [...(meta.filters ?? [])]
  };
  for (const ctor of getConstructorChain(target).reverse()) {
    for (const kind of Object.keys(ENHANCER_KEYS) as EnhancerKind[]) {
      result[kind].push(...(Reflect.getOwnMetadata(ENHANCER_KEYS[kind], ctor) ?? []));
    }
  }
  return result;
}

export function HttpCode(statusCode: number): MethodDecorator {
  return (target, propertyKey) => patchRouteOption(target, propertyKey!, { statusCode });
}

export function ApiSchema(schema: Record<string, unknown>): MethodDecorator {
  return (target, propertyKey) => patchRouteOption(target, propertyKey!, { schema });
}

export function Detail(detail: Record<string, unknown>): MethodDecorator {
  return (target, propertyKey) => patchRouteOption(target, propertyKey!, { detail });
}

/** Sets a response header on every successful response of the route. */
export function Header(name: string, value: string): MethodDecorator {
  return (target, propertyKey) => patchRouteOption(target, propertyKey!, { headers: { [name]: value } });
}

/**
 * Answers with a redirect. A handler returning `{ url, statusCode }` overrides
 * either part; returning anything else keeps the declared target.
 */
export function Redirect(url = '', statusCode = 302): MethodDecorator {
  return (target, propertyKey) => patchRouteOption(target, propertyKey!, { redirect: { url, statusCode } });
}

/**
 * Serves the route, or every route of a controller, under the given versions.
 * Has no effect unless versioning is enabled on the application.
 */
export function Version(version: VersionValue): EnhancerDecorator {
  return ((target: object, propertyKey?: string | symbol) => {
    if (propertyKey === undefined) {
      Reflect.defineMetadata(METADATA_KEYS.VERSION, version, target);
      return;
    }
    patchRouteOption(target, propertyKey, { version });
  }) as EnhancerDecorator;
}

/** The version of a controller, from `@Version` or the `@Controller` options. */
export function getControllerVersion(target: Constructor): VersionValue | undefined {
  return Reflect.getMetadata(METADATA_KEYS.VERSION, target) ?? getControllerMetaVersion(target);
}

function getControllerMetaVersion(target: Constructor): VersionValue | undefined {
  return (Reflect.getMetadata(METADATA_KEYS.CONTROLLER, target) as { version?: VersionValue } | undefined)?.version;
}

export function getRoutes(target: Constructor): RouteDefinition[] {
  const keys = getInheritedRouteKeys(target);
  const routes: RouteDefinition[] = [];
  for (const propertyKey of keys) {
    const bag = getBag(target, propertyKey);
    if (!bag.method) continue;
    routes.push({
      method: bag.method,
      path: bag.path ?? '/',
      propertyKey,
      guards: bag.guards,
      interceptors: bag.interceptors,
      pipes: bag.pipes,
      filters: bag.filters,
      schema: bag.schema,
      statusCode: bag.statusCode,
      detail: bag.detail,
      headers: bag.headers,
      redirect: bag.redirect,
      version: bag.version
    });
  }
  return routes;
}