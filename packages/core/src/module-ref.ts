import { tokenName, type Constructor, type Token } from '@drogonjs/common';
import type { Container, ContextId } from './container';

export interface ModuleRefGetOptions {
  /**
   * When true (the default), only providers the current module can inject are
   * found. When false, every module in the application is searched.
   */
  strict?: boolean;
}

/**
 * Injectable in every provider and controller. Looks up providers
 * dynamically, relative to the module that injected it.
 */
export abstract class ModuleRef {
  /** A singleton that already exists. Transient and request-scoped providers need `resolve`. */
  abstract get<T = any>(token: Token<T>, options?: ModuleRefGetOptions): NoInfer<T>;
  /** Resolves any provider, creating it if needed; request-scoped ones require a `ContextId`. */
  abstract resolve<T = any>(token: Token<T>, contextId?: ContextId, options?: ModuleRefGetOptions): Promise<NoInfer<T>>;
  /** Builds a new instance of a class that is not registered, with its dependencies injected. */
  abstract create<T>(type: Constructor<T>): Promise<T>;
}

/** @internal */
export class ModuleRefImpl extends ModuleRef {
  constructor(
    private readonly container: Container,
    private readonly allContainers: () => readonly Container[]
  ) {
    super();
  }

  get<T = any>(token: Token<T>, options: ModuleRefGetOptions = {}): NoInfer<T> {
    return this.find(token, options).get(token);
  }

  resolve<T = any>(token: Token<T>, contextId?: ContextId, options: ModuleRefGetOptions = {}): Promise<NoInfer<T>> {
    return this.find(token, options).resolve(token, contextId);
  }

  async create<T>(type: Constructor<T>): Promise<T> {
    const child = this.container.createChild();
    child.register(type);
    return child.resolve(type);
  }

  private find(token: Token, { strict = true }: ModuleRefGetOptions): Container {
    if (this.container.has(token)) return this.container;
    if (!strict) {
      const owner = this.allContainers().find(container => container.hasOwn(token));
      if (owner) return owner;
    }
    throw new Error(`[DrogonJS] Unknown provider: ${tokenName(token)}${strict ? ' (pass { strict: false } to search every module)' : ''}`);
  }
}
