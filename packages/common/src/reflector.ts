import 'reflect-metadata';
import { SetMetadata, type CustomDecorator } from './decorators/set-metadata.decorator';

type Target = Function | object;

export interface CreateDecoratorOptions<TParam, TTransformed = TParam> {
  key?: string;
  transform?: (value: TParam) => TTransformed;
}

/** A decorator made by `Reflector.createDecorator`, usable as a key for `Reflector.get`. */
export type ReflectableDecorator<TParam, TTransformed = TParam> = ((value?: TParam) => CustomDecorator) & {
  KEY: string;
  /** Carries the decorator's value type; never set at runtime. */
  readonly __type?: TTransformed;
};

type MetadataKey<T> = ReflectableDecorator<any, T> | string | symbol;

let decoratorCounter = 0;

/** Reads metadata attached with `SetMetadata` or `Reflector.createDecorator`. Injectable everywhere. */
export class Reflector {
  static createDecorator<TParam, TTransformed = TParam>(
    options: CreateDecoratorOptions<TParam, TTransformed> = {}
  ): ReflectableDecorator<TParam, TTransformed> {
    const key = options.key ?? `drogonjs:reflectable:${++decoratorCounter}`;
    const decorator = ((value?: TParam) =>
      SetMetadata(key, options.transform ? options.transform(value as TParam) : value)) as ReflectableDecorator<TParam, TTransformed>;
    decorator.KEY = key;
    return decorator;
  }

  get<TParam, TTransformed>(decorator: ReflectableDecorator<TParam, TTransformed>, target: Target): TTransformed | undefined;
  get<T = any>(key: string | symbol, target: Target): NoInfer<T> | undefined;
  get(key: MetadataKey<unknown>, target: Target): unknown {
    return Reflect.getMetadata(toKey(key), target);
  }

  getAll<TParam, TTransformed>(decorator: ReflectableDecorator<TParam, TTransformed>, targets: Target[]): Array<TTransformed | undefined>;
  getAll<T = any>(key: string | symbol, targets: Target[]): Array<NoInfer<T> | undefined>;
  getAll(key: MetadataKey<unknown>, targets: Target[]): unknown[] {
    return targets.map(target => Reflect.getMetadata(toKey(key), target));
  }

  /** The first value found, so a handler's metadata overrides its controller's. */
  getAllAndOverride<TParam, TTransformed>(decorator: ReflectableDecorator<TParam, TTransformed>, targets: Target[]): TTransformed | undefined;
  getAllAndOverride<T = any>(key: string | symbol, targets: Target[]): NoInfer<T> | undefined;
  getAllAndOverride(key: MetadataKey<unknown>, targets: Target[]): unknown {
    for (const target of targets) {
      const value = Reflect.getMetadata(toKey(key), target);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  /** Arrays are concatenated and objects merged across every target that has a value. */
  getAllAndMerge<TParam, TTransformed>(decorator: ReflectableDecorator<TParam, TTransformed>, targets: Target[]): TTransformed;
  getAllAndMerge<T = any>(key: string | symbol, targets: Target[]): NoInfer<T>;
  getAllAndMerge(key: MetadataKey<unknown>, targets: Target[]): unknown {
    const values = targets.map(target => Reflect.getMetadata(toKey(key), target)).filter(value => value !== undefined);
    if (!values.length) return [];
    if (values.length === 1) return values[0];
    if (values.every(value => typeof value === 'object' && value !== null && !Array.isArray(value))) {
      return Object.assign({}, ...values);
    }
    return values.flatMap(value => (Array.isArray(value) ? value : [value]));
  }
}

function toKey(key: MetadataKey<unknown>): string | symbol {
  return typeof key === 'function' ? key.KEY : key;
}
