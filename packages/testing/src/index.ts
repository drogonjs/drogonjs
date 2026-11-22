import {
  Global,
  Module,
  type Constructor,
  type ClassProvider,
  type FactoryProvider,
  type ModuleImport,
  type ProviderLike,
  type Token,
  type ValueProvider
} from '@drogonjs/common';
import { ApplicationContext, ContextId, type EnhancerOverride, type GetOptions } from '@drogonjs/core';

type OverrideProvider = ValueProvider | ClassProvider | FactoryProvider;

export interface TestingModuleMetadata {
  imports?: ModuleImport[];
  providers?: ProviderLike[];
  controllers?: Constructor[];
}

interface OverrideBuilder {
  useValue(value: unknown): TestingModuleBuilder;
  useClass(value: Constructor): TestingModuleBuilder;
  useFactory(factory: (...args: any[]) => unknown, inject?: Token[]): TestingModuleBuilder;
}

interface ModuleOverrideBuilder {
  useModule(replacement: ModuleImport): TestingModuleBuilder;
}

/** An application factory such as `createHonoApplication` or `createElysiaApplication`. */
export type ApplicationFactory<TOptions, TResult> = (root: ApplicationContext, options?: TOptions) => Promise<TResult>;

export class TestingModule {
  constructor(private readonly application: ApplicationContext) {}

  /** Searches every module unless `strict` is set, like `ApplicationContext.get`. */
  async get<T = any>(token: Token<T>, options?: GetOptions): Promise<NoInfer<T>> {
    return this.application.get(token, options);
  }

  /** Resolves a request-scoped or transient provider, in a fresh context unless one is given. */
  async resolve<T = any>(token: Token<T>, contextId?: ContextId, options?: Omit<GetOptions, 'contextId'>): Promise<NoInfer<T>> {
    return this.application.get(token, { ...options, contextId: contextId ?? new ContextId() });
  }

  /** The underlying application context. */
  getContext(): ApplicationContext {
    return this.application;
  }

  /**
   * Mounts the testing module's controllers with an HTTP adapter:
   * `await moduleRef.createApplication(createHonoApplication)`.
   */
  createApplication<TOptions, TResult>(factory: ApplicationFactory<TOptions, TResult>, options?: TOptions): Promise<TResult> {
    return factory(this.application, options);
  }

  async close(): Promise<void> {
    await this.application.close();
  }
}

export class TestingModuleBuilder {
  private readonly overrides = new Map<Token, OverrideProvider>();
  private readonly enhancerOverrides = new Map<unknown, EnhancerOverride>();
  private readonly moduleOverrides = new Map<unknown, ModuleImport>();

  constructor(private readonly metadata: TestingModuleMetadata) {}

  overrideProvider(token: Token): OverrideBuilder {
    return {
      useValue: (value) => {
        this.overrides.set(token, { provide: token, useValue: value });
        return this;
      },
      useClass: (value) => {
        this.overrides.set(token, { provide: token, useClass: value });
        return this;
      },
      useFactory: (factory, inject = []) => {
        this.overrides.set(token, { provide: token, useFactory: factory, inject });
        return this;
      }
    };
  }

  /** Replaces a guard class wherever it is used, at any level. */
  overrideGuard(guard: unknown): OverrideBuilder {
    return this.overrideEnhancer(guard);
  }

  overrideInterceptor(interceptor: unknown): OverrideBuilder {
    return this.overrideEnhancer(interceptor);
  }

  overridePipe(pipe: unknown): OverrideBuilder {
    return this.overrideEnhancer(pipe);
  }

  overrideFilter(filter: unknown): OverrideBuilder {
    return this.overrideEnhancer(filter);
  }

  /** Replaces a module wherever it is imported. */
  overrideModule(module: unknown): ModuleOverrideBuilder {
    return {
      useModule: (replacement) => {
        this.moduleOverrides.set(module, replacement);
        return this;
      }
    };
  }

  async compile(): Promise<TestingModule> {
    const imports = this.metadata.imports ?? [];
    const controllers = this.metadata.controllers ?? [];
    const providers = this.metadata.providers ?? [];
    const exports = providers.map(provider => (typeof provider === 'function' ? provider : provider.provide));

    // Global and exporting everything it provides, so a provider supplied to
    // the testing module satisfies a dependency of any module it imports.
    @Global()
    @Module({ imports, providers, controllers, exports })
    class RootTestingModule {}

    // Overrides replace the binding in whichever module declares the token.
    const application = await ApplicationContext.create(RootTestingModule, {
      overrides: [...this.overrides.values()],
      enhancerOverrides: this.enhancerOverrides,
      moduleOverrides: this.moduleOverrides
    });
    return new TestingModule(application);
  }

  private overrideEnhancer(enhancer: unknown): OverrideBuilder {
    return {
      useValue: (value) => {
        this.enhancerOverrides.set(enhancer, { useValue: value });
        return this;
      },
      useClass: (value) => {
        this.enhancerOverrides.set(enhancer, { useClass: value });
        return this;
      },
      useFactory: (factory, inject = []) => {
        this.enhancerOverrides.set(enhancer, { useFactory: factory, inject });
        return this;
      }
    };
  }
}

export class Test {
  static createTestingModule(metadata: TestingModuleMetadata) {
    return new TestingModuleBuilder(metadata);
  }
}
