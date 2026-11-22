import 'reflect-metadata';
import { METADATA_KEYS } from './metadata-keys';
import type { Constructor, Token } from './tokens';

export function getParamTypes(target: Constructor): Token[] {
  return Reflect.getMetadata(METADATA_KEYS.PARAM_TYPES, target) ?? [];
}

/** Parameter types TypeScript emitted for a method, used as `ArgumentMetadata.metatype`. */
export function getMethodParamTypes(target: Constructor, propertyKey: string | symbol): unknown[] {
  return Reflect.getMetadata(METADATA_KEYS.PARAM_TYPES, target.prototype, propertyKey) ?? [];
}

export function getReturnType(target: Constructor, propertyKey: string | symbol): Token | undefined {
  return Reflect.getMetadata(METADATA_KEYS.RETURN_TYPE, target, propertyKey);
}

/**
 * Walks a constructor and its ancestors, most-derived first.
 *
 * Route and parameter metadata is keyed by the exact constructor that declared
 * it, and a subclass declaring anything of its own shadows the base map rather
 * than merging with it. Inherited controllers therefore have to be traversed
 * explicitly instead of relying on the prototype-chain lookup that plain
 * `Reflect.getMetadata` performs.
 */
export function getConstructorChain(ctor: Constructor): Constructor[] {
  const chain: Constructor[] = [];
  let current: unknown = ctor;

  while (typeof current === 'function' && current !== Function.prototype) {
    chain.push(current as Constructor);
    current = Object.getPrototypeOf(current);
  }

  return chain;
}
