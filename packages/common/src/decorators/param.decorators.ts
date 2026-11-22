import 'reflect-metadata';
import { METADATA_KEYS } from '../metadata-keys';
import { getConstructorChain } from '../reflection';
import type { CustomParamFactory, ParamDefinition, ParamType } from '../route-types';
import type { Constructor } from '../tokens';

function pushParam(target: object, propertyKey: string | symbol, definition: ParamDefinition) {
  const ctor = target.constructor as Constructor;
  const map: Map<string | symbol, ParamDefinition[]> = Reflect.getOwnMetadata(METADATA_KEYS.ROUTE_ARGS, ctor) ?? new Map();
  const list = map.get(propertyKey) ?? [];
  list.push(definition);
  map.set(propertyKey, list);
  Reflect.defineMetadata(METADATA_KEYS.ROUTE_ARGS, map, ctor);
}

/**
 * `@Body()`, `@Body('field')`, `@Body(SomePipe)` and `@Body('field', SomePipe)`
 * are all accepted: a leading string is the key, everything else is a pipe.
 */
function createBuiltinParamDecorator(type: ParamType) {
  return (keyOrPipe?: unknown, ...pipes: unknown[]): ParameterDecorator => {
    const key = typeof keyOrPipe === 'string' ? keyOrPipe : undefined;
    const allPipes = typeof keyOrPipe === 'string' || keyOrPipe === undefined ? pipes : [keyOrPipe, ...pipes];
    return (target, propertyKey, index) => {
      if (propertyKey === undefined) {
        throw new Error(`[DrogonJS] @${type} can only decorate route handler parameters, not constructor parameters`);
      }
      pushParam(target, propertyKey, { index, type, key, pipes: allPipes });
    };
  };
}

export const Ctx = createBuiltinParamDecorator('ctx');
export const Req = createBuiltinParamDecorator('req');
export const Res = createBuiltinParamDecorator('res');
export const Body = createBuiltinParamDecorator('body');
export const Query = createBuiltinParamDecorator('query');
export const Param = createBuiltinParamDecorator('param');
export const Params = createBuiltinParamDecorator('params');
export const Headers = createBuiltinParamDecorator('headers');
export const Cookie = createBuiltinParamDecorator('cookie');
export const Ip = createBuiltinParamDecorator('ip');

/** A pipe instance, or a class whose instances are pipes. */
function isPipe(value: unknown): boolean {
  if (typeof value === 'function') return typeof value.prototype?.transform === 'function';
  return typeof value === 'object' && value !== null && typeof (value as { transform?: unknown }).transform === 'function';
}

/**
 * Declares a parameter decorator whose value `factory` computes from the
 * execution context. The decorator's first argument is passed to the factory as
 * `data` unless it is a pipe; any further arguments are pipes.
 *
 * ```ts
 * const User = createParamDecorator((field: string | undefined, ctx) => {
 *   const user = ctx.switchToHttp().getRequest<{ user: Record<string, unknown> }>().user;
 *   return field ? user?.[field] : user;
 * });
 * ```
 */
export function createParamDecorator<TData = any, TResult = any>(factory: CustomParamFactory<TData, TResult>) {
  return (dataOrPipe?: TData | unknown, ...pipes: unknown[]): ParameterDecorator => {
    const data = isPipe(dataOrPipe) ? undefined : dataOrPipe;
    const allPipes = isPipe(dataOrPipe) ? [dataOrPipe, ...pipes] : pipes;
    return (target, propertyKey, index) => {
      if (propertyKey === undefined) {
        throw new Error('[DrogonJS] Custom parameter decorators can only decorate route handler parameters');
      }
      pushParam(target, propertyKey, { index, type: 'custom', pipes: allPipes, factory, data });
    };
  };
}

export function getRouteParams(target: Constructor, propertyKey: string | symbol): ParamDefinition[] {
  // A subclass that declares any route gets its own metadata map, so inherited
  // handlers must be looked up along the chain. The most-derived declaration of
  // a given handler wins.
  for (const ctor of getConstructorChain(target)) {
    const map: Map<string | symbol, ParamDefinition[]> | undefined =
      Reflect.getOwnMetadata(METADATA_KEYS.ROUTE_ARGS, ctor);
    const params = map?.get(propertyKey);
    if (params) return params;
  }
  return [];
}
