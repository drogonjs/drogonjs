import 'reflect-metadata';
import { METADATA_KEYS } from '../metadata-keys';
import type { Constructor } from '../tokens';

export function Catch(...exceptionTypes: Array<new (...args: any[]) => Error>): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(METADATA_KEYS.CATCH, exceptionTypes, target);
  };
}

export function getCatchTypes(target: Constructor): Array<new (...args: any[]) => Error> {
  return Reflect.getMetadata(METADATA_KEYS.CATCH, target) ?? [];
}
