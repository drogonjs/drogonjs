import 'reflect-metadata';
import { METADATA_KEYS } from '../metadata-keys';
import type { ModuleMetadataOptions } from '../module-types';
import type { Constructor } from '../tokens';

/**
 * Own metadata only. `getModuleMetadata` walks the prototype chain, which would
 * make a module subclass silently absorb its parent's providers when merging.
 */
function getOwnModuleMetadata(target: object): ModuleMetadataOptions {
  return Reflect.getOwnMetadata(METADATA_KEYS.MODULE, target) ?? {};
}

export function Module(metadata: ModuleMetadataOptions): ClassDecorator {
  return (target) => {
    // Merged rather than assigned so `@Global()` survives regardless of the
    // order the two decorators are applied in.
    const existing = getOwnModuleMetadata(target);
    Reflect.defineMetadata(
      METADATA_KEYS.MODULE,
      { ...existing, ...metadata, global: metadata.global ?? existing.global ?? false },
      target
    );
  };
}

export function getModuleMetadata(target: Constructor): ModuleMetadataOptions {
  return Reflect.getMetadata(METADATA_KEYS.MODULE, target) ?? {};
}

export function isModule(target: Constructor): boolean {
  return Reflect.hasMetadata(METADATA_KEYS.MODULE, target);
}

export function Global(): ClassDecorator {
  return (target) => {
    const existing = getOwnModuleMetadata(target);
    Reflect.defineMetadata(METADATA_KEYS.MODULE, { ...existing, global: true }, target);
  };
}
