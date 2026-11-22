import {
  REQUEST,
  Scope,
  getInjectedTokens,
  getOptionalIndexes,
  getParamTypes,
  getPropertyDependencies,
  getProviderScope,
  isForwardReference,
  tokenName,
  type InjectionToken,
  type OptionalFactoryDependency,
  type Constructor,
  type Provider,
  type ProviderLike,
  type Token,
  isClassProvider,
  isExistingProvider,
  isFactoryProvider,
  isValueProvider
} from '@drogonjs/common';

interface CacheSlot<T = unknown> {
  instance?: T;
  /**
   * Tracked separately from `instance` so that providers legitimately resolving
   * to `undefined` (or any other falsy value) are still cached.
   */
  resolved: boolean;
  /**
   * In-flight resolution, shared by concurrent callers so an instance is only
   * ever created once even when two dependency branches request it at the
   * same time.
   */
  pending?: Promise<T>;
  /**
   * Handed out when a `forwardRef` dependency closes a cycle before the real
   * instance exists. Once constructed, the instance's own properties are copied
   * onto it and it becomes the instance.
   */
  placeholder?: T;
}

interface InstanceWrapper<T = unknown> extends CacheSlot<T> {
  token: Token<T>;
  provider: Provider<T> | Constructor<T>;
  scope: Scope;
}

/**
 * One request's slice of request-scoped instances. Everything resolved with the
 * same id shares instances; a new id starts from scratch.
 */
export class ContextId {
  /** @internal keyed on the binding, so equal tokens in different modules stay apart */
  readonly instances = new Map<InstanceWrapper, CacheSlot>();

  constructor(readonly request?: unknown) {}
}

/** Returns the container that owns `token` when this one does not. */
export type ProviderLookup = (token: Token) => Container | undefined;

export interface ContainerOptions {
  /** Used in error messages, typically the owning module's name. */
  name?: string;
  /** Called with every singleton once it has been created, dependencies first. */
  onInstantiated?: (instance: unknown) => void;
}

/**
 * Constructor parameter types that TypeScript emits for primitives and
 * interfaces. They carry no information about what to inject.
 */
const UNINJECTABLE_TYPES = new Set<unknown>([Object, String, Number, Boolean, Symbol, BigInt, Function, Array, Promise]);

export class Container {
  private readonly providers = new Map<Token, InstanceWrapper>();
  private readonly requestScopedCache = new Map<Token, boolean>();
  private lookup?: ProviderLookup;

  constructor(
    private readonly parent?: Container,
    private readonly options: ContainerOptions = {}
  ) {}

  register(providerLike: ProviderLike) {
    const token = this.getProviderToken(providerLike);
    const existing = this.providers.get(token);

    // Two modules listing the same provider must not discard an instance that
    // has already been created for it.
    if (existing && isSameProvider(existing.provider, providerLike)) return this;

    this.providers.set(token, {
      token,
      provider: providerLike,
      scope: this.resolveScope(providerLike),
      resolved: false
    });
    this.requestScopedCache.clear();
    return this;
  }

  registerMany(providers: ProviderLike[] = []) {
    for (const provider of providers) this.register(provider);
    return this;
  }

  /** Makes tokens owned by other containers resolvable here, e.g. a module's imports. */
  setLookup(lookup: ProviderLookup) {
    this.lookup = lookup;
    this.requestScopedCache.clear();
    return this;
  }

  has(token: Token): boolean {
    return token === REQUEST || this.owner(token) !== undefined;
  }

  hasOwn(token: Token): boolean {
    return this.providers.has(token);
  }

  createChild(): Container {
    return new Container(this, this.options);
  }

  async resolve<T = any>(token: Token<T>, contextId?: ContextId): Promise<NoInfer<T>> {
    return this.resolveToken(token, [], contextId);
  }

  /**
   * Synchronous lookup of a singleton that has already been created, which
   * after bootstrap is every static provider. Anything else needs `resolve`.
   */
  get<T = any>(token: Token<T>): NoInfer<T> {
    const owner = this.owner(token);
    if (!owner) throw new Error(this.unknownProviderMessage(token, []));
    if (owner !== this) return owner.get(token);
    const wrapper = this.providers.get(token)!;
    if (wrapper.resolved) return wrapper.instance as T;
    throw new Error(
      `[DrogonJS] ${tokenName(token)} is transient, request-scoped or not created yet, so it cannot be ` +
      'retrieved synchronously. Use resolve() instead.'
    );
  }

  /**
   * True when resolving `token` needs a {@link ContextId}: it is request-scoped
   * itself or depends, at any depth, on something that is.
   */
  isRequestScoped(token: Token): boolean {
    return this.computeRequestScoped(token, new Set());
  }

  /** True for providers that are created once and shared: neither transient nor request-scoped. */
  isStatic(token: Token): boolean {
    const owner = this.owner(token);
    if (!owner) return false;
    if (owner !== this) return owner.isStatic(token);
    return this.providers.get(token)!.scope !== Scope.TRANSIENT && !this.isRequestScoped(token);
  }

  private owner(token: Token): Container | undefined {
    if (this.providers.has(token)) return this;
    return this.lookup?.(token) ?? this.parent?.owner(token);
  }

  private computeRequestScoped(token: Token, visiting: Set<Token>): boolean {
    if (token === REQUEST) return true;
    const owner = this.owner(token);
    // Unknown tokens are reported when they are resolved, not here.
    if (!owner) return false;
    if (owner !== this) return owner.computeRequestScoped(token, visiting);

    const cached = this.requestScopedCache.get(token);
    if (cached !== undefined) return cached;
    // A cycle is reported as such during resolution.
    if (visiting.has(token)) return false;
    visiting.add(token);

    const wrapper = this.providers.get(token)!;
    const result =
      wrapper.scope === Scope.REQUEST ||
      dependenciesOf(wrapper.provider).some(dep => this.computeRequestScoped(dep, visiting));
    this.requestScopedCache.set(token, result);
    return result;
  }

  /**
   * @param chain tokens currently being constructed on this branch of the
   * dependency graph. Scoped per branch rather than per container so that
   * independent concurrent resolutions are never mistaken for a cycle.
   */
  private async resolveToken<T>(
    token: Token<T>,
    chain: readonly Token[],
    contextId?: ContextId,
    forward = false
  ): Promise<T> {
    if (token === REQUEST) {
      if (!contextId) {
        throw new Error('[DrogonJS] REQUEST can only be injected while a request is being handled');
      }
      return contextId.request as T;
    }

    const local = this.providers.get(token);
    if (!local) {
      const host = this.lookup?.(token) ?? (this.parent?.has(token) ? this.parent : undefined);
      if (host) return host.resolveToken(token, chain, contextId, forward);
      throw new Error(this.unknownProviderMessage(token, chain));
    }

    // Checked before the cache so a genuine cycle reports an error instead of
    // awaiting its own pending promise forever.
    if (chain.includes(token)) {
      const placeholder = forward ? this.placeholderFor(local, contextId) : undefined;
      if (placeholder) return placeholder as T;
      const path = [...chain, token].map(tokenName).join(' -> ');
      throw new Error(
        `[DrogonJS] Circular dependency detected: ${path}. ` +
        'If the cycle is intended, inject the dependency with @Inject(forwardRef(() => Type)) on both sides.'
      );
    }

    if (local.scope === Scope.TRANSIENT) {
      return this.instantiate(local.provider, [...chain, token], contextId) as Promise<T>;
    }

    // A resolved singleton is static by definition, so the dependency walk in
    // `isRequestScoped` is only paid for on the first resolution.
    if (local.resolved) return local.instance as T;

    const singleton = !this.isRequestScoped(token);
    const slot = singleton ? local : this.contextSlot(local, contextId);
    if (slot.resolved) return slot.instance as T;
    if (slot.pending) return slot.pending as Promise<T>;

    const pending = (async () => {
      const instance = (await this.instantiate(local.provider, [...chain, token], contextId)) as T;
      return slot.placeholder ? (Object.assign(slot.placeholder as object, instance) as T) : instance;
    })();
    slot.pending = pending;

    try {
      const instance = await pending;
      slot.instance = instance;
      slot.resolved = true;
      if (singleton) this.options.onInstantiated?.(instance);
      return instance;
    } finally {
      // Cleared on failure too, so a transient error does not poison the token.
      slot.pending = undefined;
    }
  }

  private placeholderFor(wrapper: InstanceWrapper, contextId?: ContextId): unknown {
    const Cls = classOf(wrapper.provider);
    if (!Cls || wrapper.scope === Scope.TRANSIENT) return undefined;
    const slot = this.isRequestScoped(wrapper.token) ? this.contextSlot(wrapper, contextId) : wrapper;
    slot.placeholder ??= Object.create(Cls.prototype);
    return slot.placeholder;
  }

  private contextSlot(wrapper: InstanceWrapper, contextId?: ContextId): CacheSlot {
    if (!contextId) {
      throw new Error(
        `[DrogonJS] ${tokenName(wrapper.token)} is request-scoped (or depends on a request-scoped provider) ` +
        'and can only be resolved while a request is being handled. Pass a ContextId to resolve it manually.'
      );
    }
    let slot = contextId.instances.get(wrapper);
    if (!slot) {
      slot = { resolved: false };
      contextId.instances.set(wrapper, slot);
    }
    return slot;
  }

  private unknownProviderMessage(token: Token, chain: readonly Token[]): string {
    const dependent = chain.at(-1);
    const neededBy = dependent === undefined ? '' : ` (needed by ${tokenName(dependent)})`;
    const where = this.options.name ? ` in ${this.options.name}` : '';
    return (
      `[DrogonJS] Unknown provider: ${tokenName(token)}${neededBy}${where}. ` +
      'Register it in this module\'s providers, or import a module that exports it.'
    );
  }

  private async instantiate<T>(providerLike: ProviderLike<T>, chain: readonly Token[], contextId?: ContextId): Promise<T> {
    if (typeof providerLike === 'function') {
      return this.instantiateClass(providerLike as Constructor<T>, chain, contextId);
    }

    const provider = providerLike as Provider<T>;

    if (isValueProvider(provider)) return provider.useValue;
    if (isExistingProvider(provider)) return this.resolveToken(provider.useExisting, chain, contextId);
    if (isFactoryProvider(provider)) {
      const deps = await Promise.all(
        (provider.inject ?? []).map(dep => {
          if (isOptionalDependency(dep)) {
            return this.has(dep.token) || !dep.optional ? this.resolveToken(dep.token, chain, contextId) : undefined;
          }
          return this.resolveToken(unwrap(dep), chain, contextId, isForwardReference(dep));
        })
      );
      return provider.useFactory(...deps);
    }
    if (isClassProvider(provider)) {
      return this.instantiateClass(provider.useClass, chain, contextId);
    }

    throw new Error('[DrogonJS] Invalid provider registration');
  }

  private async instantiateClass<T>(Cls: Constructor<T>, chain: readonly Token[], contextId?: ContextId): Promise<T> {
    const paramTypes = getParamTypes(Cls);
    const injectMap = getInjectedTokens(Cls);
    const optionalIndexes = getOptionalIndexes(Cls);
    const maxExplicit = injectMap.size ? Math.max(...injectMap.keys()) + 1 : 0;
    const size = Math.max(paramTypes.length, maxExplicit);

    const args = await Promise.all(
      Array.from({ length: size }, async (_unused, index) => {
        const explicit = injectMap.get(index);
        const forward = isForwardReference(explicit);
        const token = explicit === undefined ? paramTypes[index] : unwrap(explicit);
        const optional = optionalIndexes.has(index);

        if (token === undefined) {
          if (optional) return undefined;
          throw new Error(
            `[DrogonJS] Cannot resolve parameter #${index} of ${Cls.name}: its type is undefined at runtime, ` +
            'which usually means a circular file import. Name the dependency with @Inject(token).'
          );
        }
        if (explicit === undefined && UNINJECTABLE_TYPES.has(token)) {
          if (optional) return undefined;
          throw new Error(
            `[DrogonJS] Cannot resolve parameter #${index} of ${Cls.name}: its type compiles to ` +
            `${tokenName(token)}, which identifies nothing (primitives and interfaces are erased). ` +
            'Name the dependency with @Inject(token).'
          );
        }
        // Only a missing provider counts as absent. An error thrown while
        // building one that does exist still propagates.
        if (optional && !this.has(token)) return undefined;
        return this.resolveToken(token, chain, contextId, forward);
      })
    );

    const instance = new Cls(...args);
    await this.injectProperties(Cls, instance as object, chain, contextId);
    return instance;
  }

  private async injectProperties(Cls: Constructor, instance: object, chain: readonly Token[], contextId?: ContextId) {
    for (const dep of getPropertyDependencies(Cls)) {
      const token = unwrap(dep.token!);
      if (token === undefined || UNINJECTABLE_TYPES.has(token)) {
        if (dep.optional) continue;
        throw new Error(
          `[DrogonJS] Cannot inject property ${String(dep.key)} of ${Cls.name}: its type identifies nothing ` +
          'at runtime. Name the dependency with @Inject(token).'
        );
      }
      if (dep.optional && !this.has(token)) continue;
      (instance as Record<string | symbol, unknown>)[dep.key] = await this.resolveToken(
        token,
        chain,
        contextId,
        isForwardReference(dep.token)
      );
    }
  }

  private getProviderToken(providerLike: ProviderLike): Token {
    return typeof providerLike === 'function' ? providerLike : providerLike.provide;
  }

  private resolveScope(providerLike: ProviderLike): Scope {
    if (typeof providerLike === 'function') return getProviderScope(providerLike as Constructor);
    if (isClassProvider(providerLike)) return providerLike.scope ?? getProviderScope(providerLike.useClass);
    if (isFactoryProvider(providerLike)) return providerLike.scope ?? Scope.DEFAULT;
    return Scope.DEFAULT;
  }
}

function unwrap(token: InjectionToken): Token {
  return isForwardReference(token) ? token.forwardRef() : token;
}

function isOptionalDependency(value: unknown): value is OptionalFactoryDependency {
  return typeof value === 'object' && value !== null && 'token' in value && 'optional' in value;
}

function classOf(providerLike: ProviderLike): Constructor | undefined {
  if (typeof providerLike === 'function') return providerLike as Constructor;
  return isClassProvider(providerLike) ? providerLike.useClass : undefined;
}

/** The tokens a provider asks for when it is created. */
function dependenciesOf(providerLike: ProviderLike): Token[] {
  const classDeps = (Cls: Constructor): Token[] => {
    const injectMap = getInjectedTokens(Cls);
    const paramTypes = getParamTypes(Cls);
    const size = Math.max(paramTypes.length, injectMap.size ? Math.max(...injectMap.keys()) + 1 : 0);
    const deps: Token[] = [];
    for (let index = 0; index < size; index++) {
      const explicit = injectMap.get(index);
      const token = explicit === undefined ? paramTypes[index] : unwrap(explicit);
      if (token !== undefined) deps.push(token);
    }
    for (const dep of getPropertyDependencies(Cls)) {
      const token = unwrap(dep.token!);
      if (token !== undefined) deps.push(token);
    }
    return deps;
  };

  if (typeof providerLike === 'function') return classDeps(providerLike as Constructor);
  if (isClassProvider(providerLike)) return classDeps(providerLike.useClass);
  if (isFactoryProvider(providerLike)) {
    return (providerLike.inject ?? []).map(dep => (isOptionalDependency(dep) ? dep.token : unwrap(dep)));
  }
  if (isExistingProvider(providerLike)) return [providerLike.useExisting];
  return [];
}

/**
 * Structural identity check used to keep re-registration idempotent. Two
 * distinct object literals describing the same binding count as equal.
 */
function isSameProvider(a: ProviderLike, b: ProviderLike): boolean {
  if (a === b) return true;
  if (typeof a === 'function' || typeof b === 'function') return false;
  if (a.provide !== b.provide) return false;
  if (isValueProvider(a) && isValueProvider(b)) return a.useValue === b.useValue;
  if (isClassProvider(a) && isClassProvider(b)) return a.useClass === b.useClass && a.scope === b.scope;
  if (isExistingProvider(a) && isExistingProvider(b)) return a.useExisting === b.useExisting;
  if (isFactoryProvider(a) && isFactoryProvider(b)) {
    return (
      a.useFactory === b.useFactory &&
      a.scope === b.scope &&
      (a.inject ?? []).length === (b.inject ?? []).length &&
      (a.inject ?? []).every((token, index) => token === (b.inject ?? [])[index])
    );
  }
  return false;
}
