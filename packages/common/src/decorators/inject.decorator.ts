import 'reflect-metadata';
import { METADATA_KEYS } from '../metadata-keys';
import { getConstructorChain } from '../reflection';
import type { Constructor, ForwardReference, Token } from '../tokens';

export type InjectionToken = Token | ForwardReference;

export interface PropertyDependency {
  key: string | symbol;
  /** Undefined when the property's emitted type names the dependency. */
  token?: InjectionToken;
  optional: boolean;
}

function ownPropertyDeps(ctor: Function): Map<string | symbol, PropertyDependency> {
  return Reflect.getOwnMetadata(METADATA_KEYS.PROPERTY_DEPS, ctor) ?? new Map();
}

function updateProperty(target: object, key: string | symbol, patch: Partial<PropertyDependency>) {
  const ctor = target.constructor;
  const map = new Map(ownPropertyDeps(ctor));
  const current = map.get(key) ?? { key, optional: false };
  map.set(key, { ...current, ...patch });
  Reflect.defineMetadata(METADATA_KEYS.PROPERTY_DEPS, map, ctor);
}

/**
 * Names the dependency for a constructor parameter or, on a class property,
 * injects it into that property once the instance has been constructed. Without
 * a token a property is injected by its emitted type.
 */
export function Inject(token?: InjectionToken): ParameterDecorator & PropertyDecorator {
  return ((target: object, propertyKey: string | symbol | undefined, index?: number) => {
    if (typeof index !== 'number') {
      updateProperty(target, propertyKey!, { token: token ?? Reflect.getMetadata('design:type', target, propertyKey!) });
      return;
    }
    if (token === undefined) {
      throw new Error('[DrogonJS] @Inject() on a constructor parameter needs a token');
    }
    const ctor = (typeof target === 'function' ? target : target.constructor) as Constructor;
    const map: Map<number, InjectionToken> = new Map(Reflect.getOwnMetadata(METADATA_KEYS.INJECT_TOKENS, ctor) ?? []);
    map.set(index, token);
    Reflect.defineMetadata(METADATA_KEYS.INJECT_TOKENS, map, ctor);
  }) as ParameterDecorator & PropertyDecorator;
}

export function Optional(): ParameterDecorator & PropertyDecorator {
  return ((target: object, propertyKey: string | symbol | undefined, index?: number) => {
    if (typeof index !== 'number') {
      updateProperty(target, propertyKey!, { optional: true });
      return;
    }
    const ctor = (typeof target === 'function' ? target : target.constructor) as Constructor;
    const set: Set<number> = new Set(Reflect.getOwnMetadata(METADATA_KEYS.OPTIONAL_TOKENS, ctor) ?? []);
    set.add(index);
    Reflect.defineMetadata(METADATA_KEYS.OPTIONAL_TOKENS, set, ctor);
  }) as ParameterDecorator & PropertyDecorator;
}

export function getInjectedTokens(target: Constructor): Map<number, InjectionToken> {
  return Reflect.getMetadata(METADATA_KEYS.INJECT_TOKENS, target) ?? new Map();
}

export function getOptionalIndexes(target: Constructor): Set<number> {
  return Reflect.getMetadata(METADATA_KEYS.OPTIONAL_TOKENS, target) ?? new Set();
}

/** Property dependencies declared by a class and its ancestors; a subclass redeclaring a property wins. */
export function getPropertyDependencies(target: Constructor): PropertyDependency[] {
  const merged = new Map<string | symbol, PropertyDependency>();
  for (const ctor of getConstructorChain(target).reverse()) {
    for (const [key, dep] of ownPropertyDeps(ctor)) merged.set(key, dep);
  }
  // `@Optional()` alone does not make a property a dependency.
  return [...merged.values()].filter(dep => dep.token !== undefined);
}
