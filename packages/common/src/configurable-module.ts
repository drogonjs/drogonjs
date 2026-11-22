import type { DynamicModule, ModuleImport, Provider, ProviderLike } from './module-types';
import type { Constructor, Token } from './tokens';

/** A class the async variant can build to obtain the options. */
export type ConfigurableModuleOptionsFactory<Options, FactoryMethod extends string> = Record<
  FactoryMethod,
  () => Options | Promise<Options>
>;

export type ConfigurableModuleAsyncOptions<Options, FactoryMethod extends string = 'create'> = {
  imports?: ModuleImport[];
  inject?: Token[];
  useFactory?: (...args: any[]) => Options | Promise<Options>;
  useClass?: Constructor<ConfigurableModuleOptionsFactory<Options, FactoryMethod>>;
  useExisting?: Token<ConfigurableModuleOptionsFactory<Options, FactoryMethod>>;
  /** Providers made available to the factory's `inject` list. */
  extraProviders?: Provider[];
};

export type ConfigurableModuleCls<
  Options,
  MethodKey extends string,
  FactoryMethod extends string,
  Extras
> = (new () => any) & Record<MethodKey, (options: Options & Partial<Extras>) => DynamicModule> &
  Record<`${MethodKey}Async`, (options: ConfigurableModuleAsyncOptions<Options, FactoryMethod> & Partial<Extras>) => DynamicModule>;

export interface ConfigurableModuleHost<Options, MethodKey extends string, FactoryMethod extends string, Extras> {
  ConfigurableModuleClass: ConfigurableModuleCls<Options, MethodKey, FactoryMethod, Extras>;
  MODULE_OPTIONS_TOKEN: symbol;
  /** Type carriers only (`typeof OPTIONS_TYPE`); the values are undefined. */
  OPTIONS_TYPE: Options & Partial<Extras>;
  ASYNC_OPTIONS_TYPE: ConfigurableModuleAsyncOptions<Options, FactoryMethod> & Partial<Extras>;
}

export interface ConfigurableModuleBuilderOptions {
  /** Used to name the options token. */
  moduleName?: string;
  /** Use an existing token instead of creating one. */
  optionsInjectionToken?: symbol;
}

/**
 * Generates `register`/`registerAsync` (or `forRoot`/`forRootAsync`, …) for a
 * module that takes options.
 *
 * ```ts
 * export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN } =
 *   new ConfigurableModuleBuilder<CacheOptions>().setClassMethodName('forRoot').build();
 *
 * @Module({ providers: [CacheService], exports: [CacheService] })
 * export class CacheModule extends ConfigurableModuleClass {}
 * ```
 */
export class ConfigurableModuleBuilder<
  Options,
  MethodKey extends string = 'register',
  FactoryMethod extends string = 'create',
  Extras = {}
> {
  private methodKey = 'register' as MethodKey;
  private factoryMethod = 'create' as FactoryMethod;
  private extras?: Extras;
  private transformDefinition?: (definition: DynamicModule, extras: Extras) => DynamicModule;

  constructor(private readonly builderOptions: ConfigurableModuleBuilderOptions = {}) {}

  setClassMethodName<K extends string>(key: K): ConfigurableModuleBuilder<Options, K, FactoryMethod, Extras> {
    const next = this as unknown as ConfigurableModuleBuilder<Options, K, FactoryMethod, Extras>;
    next.methodKey = key;
    return next;
  }

  setFactoryMethodName<K extends string>(key: K): ConfigurableModuleBuilder<Options, MethodKey, K, Extras> {
    const next = this as unknown as ConfigurableModuleBuilder<Options, MethodKey, K, Extras>;
    next.factoryMethod = key;
    return next;
  }

  /**
   * Declares options that shape the module definition rather than reach the
   * options provider, such as `isGlobal`. They are removed from the options.
   */
  setExtras<E extends Record<string, unknown>>(
    extras: E,
    transform: (definition: DynamicModule, extras: E) => DynamicModule = definition => definition
  ): ConfigurableModuleBuilder<Options, MethodKey, FactoryMethod, E> {
    const next = this as unknown as ConfigurableModuleBuilder<Options, MethodKey, FactoryMethod, E>;
    next.extras = extras;
    next.transformDefinition = transform;
    return next;
  }

  build(): ConfigurableModuleHost<Options, MethodKey, FactoryMethod, Extras> {
    const name = this.builderOptions.moduleName ?? 'Configurable';
    const token = this.builderOptions.optionsInjectionToken ?? Symbol(`${name.toUpperCase()}_MODULE_OPTIONS`);
    const { methodKey, factoryMethod } = this;
    const defaults = (this.extras ?? {}) as Record<string, unknown>;
    const transform = this.transformDefinition ?? ((definition: DynamicModule) => definition);

    const split = (input: Record<string, unknown>) => {
      const options: Record<string, unknown> = {};
      const extras: Record<string, unknown> = { ...defaults };
      for (const [key, value] of Object.entries(input ?? {})) {
        if (key in defaults) extras[key] = value;
        else options[key] = value;
      }
      return { options, extras: extras as Extras };
    };

    class ConfigurableModuleClass {
      static [methodKey](this: Constructor, input: Record<string, unknown>): DynamicModule {
        const { options, extras } = split(input);
        return transform({ module: this, providers: [{ provide: token, useValue: options }] }, extras);
      }

      static [`${methodKey}Async`](this: Constructor, input: ConfigurableModuleAsyncOptions<Options, FactoryMethod> & Record<string, unknown>): DynamicModule {
        const { imports, inject, useFactory, useClass, useExisting, extraProviders, ...rest } = input;
        const { extras } = split(rest);
        const providers: ProviderLike[] = [...(extraProviders ?? [])];

        if (useFactory) {
          providers.push({ provide: token, useFactory, inject: inject ?? [] });
        } else if (useClass || useExisting) {
          const factoryToken = useExisting ?? useClass!;
          if (useClass) providers.push(useClass);
          providers.push({
            provide: token,
            useFactory: (factory: Record<string, () => unknown>) => factory[factoryMethod]!(),
            inject: [factoryToken]
          });
        } else {
          throw new Error(`[DrogonJS] ${this.name}.${methodKey}Async needs useFactory, useClass or useExisting`);
        }

        return transform({ module: this, imports: imports ?? [], providers }, extras);
      }
    }

    return {
      ConfigurableModuleClass: ConfigurableModuleClass as unknown as ConfigurableModuleCls<Options, MethodKey, FactoryMethod, Extras>,
      MODULE_OPTIONS_TOKEN: token,
      OPTIONS_TYPE: undefined as never,
      ASYNC_OPTIONS_TYPE: undefined as never
    };
  }
}
