import 'reflect-metadata';
import { METADATA_KEYS } from '../metadata-keys';
import { Scope } from '../scope';
import type { Constructor } from '../tokens';

export interface InjectableOptions {
  scope?: Scope;
}

export function Injectable(options: InjectableOptions = {}): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(METADATA_KEYS.INJECTABLE, true, target);
    Reflect.defineMetadata(METADATA_KEYS.SCOPE, options.scope ?? Scope.DEFAULT, target);
  };
}

export function isInjectable(target: Constructor): boolean {
  return Reflect.getMetadata(METADATA_KEYS.INJECTABLE, target) === true;
}

export function getProviderScope(target: Constructor): Scope {
  return Reflect.getMetadata(METADATA_KEYS.SCOPE, target) ?? Scope.DEFAULT;
}
