import type { ResponseHandle } from './interfaces';
import type { RequestMethod } from './route-types';
import type { Constructor } from './tokens';

/**
 * Runs before guards on the routes it is applied to. `req` is the platform's
 * Fetch `Request`, the same object guards get from `getRequest()`, so a value
 * attached to it (`req.user = ...`) is visible further down the chain.
 *
 * Call `next()` to continue. Returning a value without calling it answers the
 * request with that value instead.
 */
export interface DrogonMiddleware<TRequest = Request> {
  use(req: TRequest, res: ResponseHandle, next: () => Promise<void>): unknown | Promise<unknown>;
}

export type FunctionMiddleware<TRequest = Request> = (
  req: TRequest,
  res: ResponseHandle,
  next: () => Promise<void>
) => unknown | Promise<unknown>;

export type MiddlewareLike = Constructor<DrogonMiddleware<any>> | DrogonMiddleware<any> | FunctionMiddleware<any>;

export interface RouteInfo {
  path: string;
  method: RequestMethod;
}

/** A path pattern (`'cats'`, `'cats/*'`, `'*'`), a route, or a controller class. */
export type MiddlewareRoute = string | RouteInfo | Constructor;

export interface MiddlewareConfigProxy {
  exclude(...routes: Array<string | RouteInfo>): MiddlewareConfigProxy;
  forRoutes(...routes: MiddlewareRoute[]): MiddlewareConsumer;
}

export interface MiddlewareConsumer {
  apply(...middleware: MiddlewareLike[]): MiddlewareConfigProxy;
}

/** A module class implementing this has `configure` called once while routes are mounted. */
export interface DrogonModule {
  configure(consumer: MiddlewareConsumer): void;
}

export interface MiddlewareConfiguration {
  middleware: MiddlewareLike[];
  forRoutes: MiddlewareRoute[];
  exclude: Array<string | RouteInfo>;
}
