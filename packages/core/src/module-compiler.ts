import {
  getModuleMetadata,
  isDynamicModule,
  isForwardReference,
  type Constructor,
  type DynamicModule,
  type ModuleImport,
  type ModuleMetadataOptions,
  type ProviderLike,
  type Token
} from '@drogonjs/common';

export interface CompiledModule {
  type: Constructor;
  imports: CompiledModule[];
  providers: ProviderLike[];
  controllers: Constructor[];
  exports: Token[];
  global: boolean;
}

/** Replacements applied wherever a module is imported, keyed by the module class. */
export type ModuleOverrides = Map<unknown, ModuleImport>;

export async function compileModule(
  input: ModuleImport,
  stack = new Map<Constructor, CompiledModule>(),
  cache = new Map<Constructor, CompiledModule>(),
  overrides: ModuleOverrides = new Map()
): Promise<CompiledModule> {
  let resolved = await Promise.resolve(input as Awaited<ModuleImport>);
  if (isForwardReference(resolved)) resolved = await Promise.resolve(resolved.forwardRef());
  if (resolved === undefined) {
    throw new Error(
      '[DrogonJS] A module import is undefined, which usually means a circular file import. ' +
      'Wrap it with forwardRef(() => Module).'
    );
  }
  const replacement = overrides.get(isDynamicModule(resolved) ? resolved.module : resolved);
  if (replacement !== undefined) resolved = await Promise.resolve(replacement as Awaited<ModuleImport>);
  const moduleType = (isDynamicModule(resolved) ? resolved.module : resolved) as Constructor;

  // A module reached through several import paths is compiled once and shared.
  // Dynamic modules are excluded: the same class may carry different metadata
  // at each registration site.
  const cacheable = !isDynamicModule(resolved);
  if (cacheable) {
    const hit = cache.get(moduleType);
    if (hit) return hit;
  }

  const staticMeta = getModuleMetadata(moduleType);
  const dynamicMeta: Partial<DynamicModule> = isDynamicModule(resolved) ? resolved : {};
  const staticExports = normalizeExports(staticMeta.exports);
  const dynamicExports = normalizeExports(dynamicMeta.exports);

  const merged: ModuleMetadataOptions & { exports: Token[] } = {
    imports: [...(staticMeta.imports ?? []), ...(dynamicMeta.imports ?? [])],
    providers: [...(staticMeta.providers ?? []), ...(dynamicMeta.providers ?? [])],
    controllers: [...(staticMeta.controllers ?? []), ...(dynamicMeta.controllers ?? [])],
    exports: [...staticExports, ...dynamicExports],
    global: dynamicMeta.global ?? staticMeta.global ?? false
  };

  // A circular import gets the module that is still being compiled further up
  // the stack, so the graph contains one shared object per module rather than
  // a disconnected copy that would own a second set of providers.
  const inProgress = stack.get(moduleType);
  if (inProgress) return inProgress;

  const compiled: CompiledModule = {
    type: moduleType,
    imports: [],
    providers: merged.providers ?? [],
    controllers: merged.controllers ?? [],
    exports: merged.exports,
    global: merged.global ?? false
  };

  const next = new Map(stack);
  next.set(moduleType, compiled);

  for (const imported of merged.imports ?? []) {
    compiled.imports.push(await compileModule(imported, next, cache, overrides));
  }

  if (cacheable) cache.set(moduleType, compiled);
  return compiled;
}

function normalizeExports(items?: Array<Token | DynamicModule>): Token[] {
  if (!items?.length) return [];
  const exports: Token[] = [];
  for (const item of items) {
    if (isDynamicModule(item)) exports.push(item.module as Constructor);
    else exports.push(item as Token);
  }
  return exports;
}
