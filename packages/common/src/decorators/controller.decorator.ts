import 'reflect-metadata';
import { METADATA_KEYS } from '../metadata-keys';
import type { ControllerOptions } from '../route-types';
import type { Constructor } from '../tokens';

interface ControllerMeta extends ControllerOptions {
  path: string;
}

/** `@Controller('cats')`, `@Controller('cats', options)` or `@Controller({ path: 'cats', version: '1' })`. */
export function Controller(pathOrOptions: string | ControllerOptions = '', options: ControllerOptions = {}): ClassDecorator {
  const resolved = typeof pathOrOptions === 'string' ? { ...options, path: pathOrOptions } : pathOrOptions;
  return (target) => {
    Reflect.defineMetadata(METADATA_KEYS.CONTROLLER, { ...resolved, path: normalizePath(resolved.path ?? '') }, target);
  };
}

export function getControllerMeta(target: Constructor): ControllerMeta {
  return Reflect.getMetadata(METADATA_KEYS.CONTROLLER, target) ?? { path: '' };
}

export function isController(target: Constructor): boolean {
  return Reflect.hasMetadata(METADATA_KEYS.CONTROLLER, target);
}

function normalizePath(path: string): string {
  if (!path) return '';
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  return trimmed.endsWith('/') && trimmed.length > 1 ? trimmed.slice(0, -1) : trimmed;
}
