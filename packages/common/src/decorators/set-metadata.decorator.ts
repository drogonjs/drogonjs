import 'reflect-metadata';

export type CustomDecorator<K = string> = ClassDecorator & MethodDecorator & { KEY: K };

/**
 * Attaches `value` under `key` to a controller class or a route handler, for
 * guards and interceptors to read back through `Reflector`.
 */
export function SetMetadata<K = string, V = unknown>(key: K, value: V): CustomDecorator<K> {
  const decorator = ((target: object, _propertyKey?: string | symbol, descriptor?: PropertyDescriptor) => {
    Reflect.defineMetadata(key, value, descriptor ? descriptor.value : target);
    return descriptor;
  }) as CustomDecorator<K>;
  decorator.KEY = key;
  return decorator;
}
