import {
  APP_FILTER,
  APP_GUARD,
  APP_INTERCEPTOR,
  APP_PIPE,
  Logger,
  Reflector,
  tokenName,
  type Constructor,
  type ModuleImport,
  type Provider,
  type ProviderLike,
  type Token
} from '@drogonjs/common';
import { Container, type ContextId } from './container';
import { compileModule, type CompiledModule, type ModuleOverrides } from './module-compiler';
import { ModuleRef, ModuleRefImpl } from './module-ref';
import { ModuleRegistry } from './module-registry';

type LifecycleHookName =
  | 'onModuleInit'
  | 'onApplicationBootstrap'
  | 'onModuleDestroy'
  | 'beforeApplicationShutdown'
  | 'onApplicationShutdown';

type LifecycleCapable = {
  onModuleInit?: () => void | Promise<void>;
  onApplicationBootstrap?: () => void | Promise<void>;
  onModuleDestroy?: () => void | Promise<void>;
  beforeApplicationShutdown?: (signal?: string) => void | Promise<void>;
  onApplicationShutdown?: (signal?: string) => void | Promise<void>;
};

export interface ApplicationContextOptions {
  /**
   * Replaces the provider bound to each token in every module that declares
   * it. Used by `@drogonjs/testing` for `overrideProvider()`.
   */
  overrides?: Provider[];
  /** Replaces a module wherever it is imported. Used for `overrideModule()`. */
  moduleOverrides?: ModuleOverrides;
  /**
   * Replaces a guard, interceptor, pipe or filter class wherever it is used as
   * an enhancer. Used for `overrideGuard()` and friends.
   */
  enhancerOverrides?: Map<unknown, EnhancerOverride>;
}

export type EnhancerOverride =
  | { useValue: unknown }
  | { useClass: Constructor }
  | { useFactory: (...args: any[]) => unknown; inject?: Token[] };

export type AppEnhancerKind = 'guard' | 'interceptor' | 'pipe' | 'filter';

/** A provider registered under `APP_GUARD` and friends, rebound to a token of its own. */
export interface AppEnhancer {
  kind: AppEnhancerKind;
  token: symbol;
  container: Container;
}

const APP_ENHANCER_KINDS = new Map<Token, AppEnhancerKind>([
  [APP_GUARD, 'guard'],
  [APP_INTERCEPTOR, 'interceptor'],
  [APP_PIPE, 'pipe'],
  [APP_FILTER, 'filter']
]);

export interface GetOptions {
  /**
   * When true, only tokens the root module can inject are found. By default
   * any module's providers are searched as a fallback.
   */
  strict?: boolean;
  /** Required to resolve request-scoped providers. */
  contextId?: ContextId;
}

export interface ModuleEntry {
  module: CompiledModule;
  container: Container;
}

export interface ControllerRef extends ModuleEntry {
  type: Constructor;
}

export class ApplicationContext {
  /** The root module's container. */
  readonly container: Container;
  readonly root: CompiledModule;
  readonly registry: ModuleRegistry;
  private readonly modules: ModuleEntry[];
  private readonly instances: object[];
  private readonly appEnhancers: AppEnhancer[];
  private readonly enhancerOverrides: Map<unknown, EnhancerOverride>;
  private closed = false;
  private shutdownListener?: (signal: NodeJS.Signals) => void;
  private shutdownSignals: NodeJS.Signals[] = [];

  private constructor(
    root: CompiledModule,
    registry: ModuleRegistry,
    modules: ModuleEntry[],
    instances: object[],
    appEnhancers: AppEnhancer[],
    enhancerOverrides: Map<unknown, EnhancerOverride>
  ) {
    this.root = root;
    this.registry = registry;
    this.modules = modules;
    this.instances = instances;
    this.appEnhancers = appEnhancers;
    this.enhancerOverrides = enhancerOverrides;
    this.container = modules.find(ref => ref.module === root)!.container;
  }

  static async create(rootModule: ModuleImport, options: ApplicationContextOptions = {}): Promise<ApplicationContext> {
    const root = await compileModule(rootModule, undefined, undefined, options.moduleOverrides);
    const registry = new ModuleRegistry().register(root);
    const compiledModules = collectModules(root);
    const overrides = new Map<Token, Provider>((options.overrides ?? []).map(p => [p.provide, p]));

    // Singletons are recorded as they finish construction, which puts every
    // dependency ahead of its dependents. Teardown walks this list backwards.
    const created: object[] = [];
    const onInstantiated = (instance: unknown) => {
      if (isHookTarget(instance)) created.push(instance);
    };

    // Each module owns its providers. Registration is completed for the whole
    // graph before anything is instantiated, so a provider may depend on a
    // token contributed by a module that appears later in the import order.
    const reflector = new Reflector();
    const appEnhancers: AppEnhancer[] = [];
    const containers: Container[] = [];
    const modules: ModuleEntry[] = compiledModules.map(compiled => {
      const container = new Container(undefined, { name: compiled.type.name, onInstantiated });
      containers.push(container);
      // Available to every module without an import, as in NestJS.
      container.register({ provide: Reflector, useValue: reflector });
      container.register({ provide: ModuleRef, useValue: new ModuleRefImpl(container, () => containers) });
      container.register(compiled.type);
      for (const provider of compiled.providers) {
        const kind = APP_ENHANCER_KINDS.get(providerToken(provider));
        if (kind && typeof provider !== 'function') {
          // Each registration is its own enhancer, so it gets a token of its own.
          const token = Symbol(`${tokenName(provider.provide)}#${appEnhancers.length}`);
          container.register({ ...provider, provide: token } as Provider);
          appEnhancers.push({ kind, token, container });
          continue;
        }
        container.register(overrides.get(providerToken(provider)) ?? provider);
      }
      container.registerMany(compiled.controllers);
      return { module: compiled, container };
    });

    linkModules(modules);

    await warmUp(modules);
    for (const { token, container } of appEnhancers) {
      if (container.isStatic(token)) await container.resolve(token);
    }
    const instances = [...new Set(created)];
    await runHook(instances, 'onModuleInit');
    await runHook(instances, 'onApplicationBootstrap');
    return new ApplicationContext(root, registry, modules, instances, appEnhancers, options.enhancerOverrides ?? new Map());
  }

  /** Global enhancers registered as `APP_GUARD`, `APP_PIPE`, … providers, in module order. */
  getAppEnhancers(kind: AppEnhancerKind): AppEnhancer[] {
    return this.appEnhancers.filter(enhancer => enhancer.kind === kind);
  }

  /** @internal the replacement registered for an enhancer class, if any */
  getEnhancerOverride(item: unknown): EnhancerOverride | undefined {
    return this.enhancerOverrides.get(item);
  }

  async get<T = any>(token: Token<T>, options: GetOptions = {}): Promise<NoInfer<T>> {
    if (this.container.has(token)) return this.container.resolve(token, options.contextId);
    if (!options.strict) {
      const owner = this.modules.find(ref => ref.container.hasOwn(token));
      if (owner) return owner.container.resolve(token, options.contextId);
    }
    throw new Error(`[DrogonJS] Unknown provider: ${tokenName(token)}`);
  }

  /** Every module in the graph, imports before importers. */
  getModules(): readonly ModuleEntry[] {
    return this.modules;
  }

  /**
   * Controllers with the container of the module that declares them. A
   * controller listed by several modules is reported once, for the first.
   */
  getControllers(): ControllerRef[] {
    const seen = new Set<Constructor>();
    const controllers: ControllerRef[] = [];
    for (const ref of this.modules) {
      for (const type of ref.module.controllers) {
        if (seen.has(type)) continue;
        seen.add(type);
        controllers.push({ ...ref, type });
      }
    }
    return controllers;
  }

  /**
   * Runs `close(signal)` when the process receives one of `signals`, then
   * re-raises the signal so the process exits as it would have otherwise.
   */
  enableShutdownHooks(signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT']): this {
    if (this.shutdownListener) return this;
    // Runtimes without process signals, such as Workers, have nothing to hook.
    if (typeof process === 'undefined' || typeof process.on !== 'function') return this;

    const listener = (signal: NodeJS.Signals) => {
      this.removeShutdownListeners();
      this.close(signal)
        .catch(error => new Logger('ApplicationContext').error('Error during shutdown', error))
        .finally(() => process.kill(process.pid, signal));
    };

    this.shutdownListener = listener;
    this.shutdownSignals = signals;
    for (const signal of signals) process.on(signal, listener);
    return this;
  }

  async close(signal?: string): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.removeShutdownListeners();
    const teardownOrder = [...this.instances].reverse();
    await runHook(teardownOrder, 'onModuleDestroy');
    await runHook(teardownOrder, 'beforeApplicationShutdown', signal);
    await runHook(teardownOrder, 'onApplicationShutdown', signal);
  }

  private removeShutdownListeners() {
    if (!this.shutdownListener) return;
    for (const signal of this.shutdownSignals) process.removeListener(signal, this.shutdownListener);
    this.shutdownListener = undefined;
  }
}

function providerToken(provider: ProviderLike): Token {
  return typeof provider === 'function' ? provider : provider.provide;
}

/** Flattens the module graph into a de-duplicated, imports-first ordering. */
function collectModules(root: CompiledModule): CompiledModule[] {
  const ordered: CompiledModule[] = [];
  // Keyed on the compiled instance, not the module type: the compiler hands back
  // one object per statically imported module, so diamonds still collapse, while
  // two dynamic registrations of the same class both contribute their providers.
  const seen = new Set<CompiledModule>();

  const walk = (compiled: CompiledModule) => {
    if (seen.has(compiled)) return;
    seen.add(compiled);
    for (const imported of compiled.imports) walk(imported);
    ordered.push(compiled);
  };

  walk(root);
  return ordered;
}

/**
 * Gives each module's container access to exactly what it may inject: the
 * exports of the modules it imports, then the exports of global modules.
 */
function linkModules(modules: ModuleEntry[]) {
  const containers = new Map(modules.map(ref => [ref.module, ref.container]));
  const exportCache = new Map<CompiledModule, Map<Token, Container>>();

  const exportsOf = (compiled: CompiledModule, visiting: Set<CompiledModule>): Map<Token, Container> => {
    const cached = exportCache.get(compiled);
    if (cached) return cached;
    // Re-exports that loop back through a circular import contribute nothing new.
    if (visiting.has(compiled)) return new Map();
    visiting.add(compiled);

    const container = containers.get(compiled)!;
    const result = new Map<Token, Container>();

    for (const token of compiled.exports) {
      const reexported = compiled.imports.find(imported => imported.type === token);
      if (reexported) {
        for (const [exported, host] of exportsOf(reexported, visiting)) result.set(exported, host);
        continue;
      }
      if (container.hasOwn(token)) {
        result.set(token, container);
        continue;
      }
      const host = compiled.imports
        .map(imported => exportsOf(imported, visiting).get(token))
        .find(Boolean);
      if (host) {
        result.set(token, host);
        continue;
      }
      throw new Error(
        `[DrogonJS] ${compiled.type.name} exports ${tokenName(token)}, but neither provides it ` +
        'nor imports a module that exports it.'
      );
    }

    visiting.delete(compiled);
    exportCache.set(compiled, result);
    return result;
  };

  // Validated for every module, not only imported ones, so a bad export on the
  // root module is reported too.
  for (const ref of modules) exportsOf(ref.module, new Set());

  const globals = modules.filter(ref => ref.module.global).map(ref => ref.module);

  for (const { module: compiled, container } of modules) {
    const visible = new Map<Token, Container>();
    for (const imported of compiled.imports) {
      for (const [token, host] of exportsOf(imported, new Set())) {
        if (!visible.has(token)) visible.set(token, host);
      }
    }
    for (const globalModule of globals) {
      if (globalModule === compiled) continue;
      for (const [token, host] of exportsOf(globalModule, new Set())) {
        if (!visible.has(token)) visible.set(token, host);
      }
    }
    container.setLookup(token => visible.get(token));
  }
}

/** Creates every singleton up front. Transient and request-scoped providers are created on demand. */
async function warmUp(modules: ModuleEntry[]) {
  for (const { module: compiled, container } of modules) {
    const tokens: Token[] = [compiled.type, ...compiled.providers.map(providerToken), ...compiled.controllers];
    for (const token of tokens) {
      if (container.isStatic(token)) await container.resolve(token);
    }
  }
}

function isHookTarget(value: unknown): value is object {
  return typeof value === 'object' ? value !== null : typeof value === 'function';
}

async function runHook(instances: object[], hook: LifecycleHookName, signal?: string) {
  for (const instance of instances) {
    const fn = (instance as LifecycleCapable)[hook];
    if (typeof fn === 'function') {
      await (fn as (arg?: string) => void | Promise<void>).call(instance, signal);
    }
  }
}
