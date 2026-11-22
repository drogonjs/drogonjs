import type { FactoryProvider, ModuleImport } from '@drogonjs/common';
import { CONFIGURATION_TOKEN } from './tokens';

export type ConfigFactory<T = Record<string, unknown>> = () => T | Promise<T>;

export type ConfigType<T extends (...args: any[]) => any> = Awaited<ReturnType<T>>;

export interface NamespacedConfigFactory<T> extends ConfigFactory<T> {
  /** Inject the namespace's values with `@Inject(config.KEY)`. */
  KEY: symbol;
  NAMESPACE: string;
  /** For `forRootAsync({ ...config.asProvider() })` of another module. */
  asProvider(): { imports: ModuleImport[]; useFactory: (value: T) => T; inject: symbol[] };
}

/**
 * A configuration factory whose values live under `namespace`, read with
 * `config.get('namespace.key')` or injected whole through `factory.KEY`.
 */
export function registerAs<T extends Record<string, unknown>>(namespace: string, factory: ConfigFactory<T>): NamespacedConfigFactory<T> {
  const namespaced = (() => factory()) as NamespacedConfigFactory<T>;
  namespaced.KEY = Symbol.for(`drogonjs:config:${namespace}`);
  namespaced.NAMESPACE = namespace;
  namespaced.asProvider = () => ({
    // Resolved lazily to avoid a circular import with the module file.
    imports: [import('./config.module').then(({ ConfigModule }) => ConfigModule.forFeature(namespaced))],
    useFactory: (value: T) => value,
    inject: [namespaced.KEY]
  });
  return namespaced;
}

export function isNamespaced(factory: ConfigFactory<unknown>): factory is NamespacedConfigFactory<any> {
  return typeof (factory as NamespacedConfigFactory<unknown>).KEY === 'symbol';
}

/** The provider for a namespace's `KEY`, reading the value merged into the shared configuration. */
export function namespaceProvider(factory: NamespacedConfigFactory<any>, register: boolean): FactoryProvider {
  return {
    provide: factory.KEY,
    useFactory: async (configuration?: Record<string, unknown>) => {
      if (!register && configuration && factory.NAMESPACE in configuration) return configuration[factory.NAMESPACE];
      const value = await factory();
      if (configuration) configuration[factory.NAMESPACE] = value;
      return value;
    },
    inject: [{ token: CONFIGURATION_TOKEN, optional: true }]
  };
}
