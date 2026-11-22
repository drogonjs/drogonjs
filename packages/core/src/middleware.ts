import type {
  Constructor,
  MiddlewareConfigProxy,
  MiddlewareConfiguration,
  MiddlewareConsumer,
  MiddlewareLike,
  MiddlewareRoute,
  RouteInfo
} from '@drogonjs/common';

/** Collects what a module's `configure(consumer)` applies. */
export class MiddlewareBuilder implements MiddlewareConsumer {
  readonly configurations: MiddlewareConfiguration[] = [];

  apply(...middleware: MiddlewareLike[]): MiddlewareConfigProxy {
    const flat = middleware.flat() as MiddlewareLike[];
    if (!flat.length) throw new Error('[DrogonJS] consumer.apply() needs at least one middleware');
    const exclude: Array<string | RouteInfo> = [];
    const proxy: MiddlewareConfigProxy = {
      exclude: (...routes) => {
        exclude.push(...routes);
        return proxy;
      },
      forRoutes: (...routes) => {
        this.configurations.push({ middleware: flat, forRoutes: routes, exclude });
        return this;
      }
    };
    return proxy;
  }
}

/** A mounted route as middleware and the global prefix see it: without prefix or version. */
export interface RouteTarget {
  path: string;
  method: string;
  controller: Constructor;
}

/**
 * Path patterns are compared with the route's declared path: `:name` matches
 * one segment and `*` (or `{*name}`) matches anything, so `'cats/*'` covers
 * `/cats/:id` and `'cats'` covers `/cats` only.
 */
export function pathMatches(pattern: string, path: string): boolean {
  const normalized = normalize(pattern);
  if (normalized === '/*' || normalized === '/') return normalized === '/*' || normalize(path) === '/';
  const source = normalized
    .split(/(\{\*[^}]*\}|\(\.\*\)|\*|:[A-Za-z0-9_]+)/)
    .map(part => {
      if (!part) return '';
      if (part === '*' || part === '(.*)' || part.startsWith('{*')) return '.*';
      if (part.startsWith(':')) return '[^/]+';
      return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  // `cats/*` also covers `/cats` itself.
  const regex = new RegExp(`^${source.replace(/\/\.\*$/, '(?:/.*)?')}$`);
  return regex.test(normalize(path));
}

function normalize(path: string): string {
  const withSlash = path.startsWith('/') ? path : `/${path}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash;
}

export function routeInfoMatches(info: string | RouteInfo, route: RouteTarget): boolean {
  if (typeof info === 'string') return pathMatches(info, route.path);
  const methodMatches = info.method === 'ALL' || info.method === route.method || route.method === 'ALL';
  return methodMatches && pathMatches(info.path, route.path);
}

export function middlewareApplies(config: MiddlewareConfiguration, route: RouteTarget): boolean {
  if (config.exclude.some(info => routeInfoMatches(info, route))) return false;
  return config.forRoutes.some((target: MiddlewareRoute) => {
    if (typeof target === 'function') return target === route.controller || route.controller.prototype instanceof target;
    return routeInfoMatches(target, route);
  });
}
