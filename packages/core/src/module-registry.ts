import type { Constructor, Token } from '@drogonjs/common';
import type { Container } from './container';
import type { CompiledModule } from './module-compiler';

export class ModuleRegistry {
  private readonly exportsMap = new Map<Constructor, Set<Token>>();

  register(compiled: CompiledModule) {
    this.walk(compiled, new Set());
    return this;
  }

  getExports(moduleType: Constructor): Set<Token> {
    return this.exportsMap.get(moduleType) ?? new Set();
  }

  isExported(moduleType: Constructor, token: Token): boolean {
    return this.getExports(moduleType).has(token);
  }

  canAccess(container: Container & { hasOwn(token: Token): boolean }, moduleType: Constructor, token: Token): boolean {
    return container.hasOwn(token) || this.isExported(moduleType, token);
  }

  /**
   * Keyed on the compiled instance rather than the module type: a shared module
   * reached through several import paths is one object, so this collapses the
   * repeated traversal of diamond graphs, while two dynamic registrations of the
   * same class stay distinct and both get walked.
   */
  private walk(compiled: CompiledModule, seen: Set<CompiledModule>) {
    if (seen.has(compiled)) return;
    seen.add(compiled);

    if (!this.exportsMap.has(compiled.type)) {
      this.exportsMap.set(compiled.type, new Set(compiled.exports));
    }
    for (const imported of compiled.imports) {
      this.walk(imported, seen);
    }
  }
}
