import type { ClassLike, Constructor, ForwardReference, Token } from './tokens';
import type { Scope } from './scope';

export type Factory<T = any> = (...args: any[]) => T | Promise<T>;

export interface ClassProvider<T = any> {
  provide: Token<T>;
  useClass: Constructor<T>;
  scope?: Scope;
}

export interface ValueProvider<T = any> {
  provide: Token<T>;
  useValue: T;
}

/** A factory dependency that resolves to `undefined` when no provider exists. */
export interface OptionalFactoryDependency {
  token: Token;
  optional: boolean;
}

export interface FactoryProvider<T = any> {
  provide: Token<T>;
  useFactory: Factory<T>;
  inject?: Array<Token | OptionalFactoryDependency | ForwardReference>;
  scope?: Scope;
}

export interface ExistingProvider<T = any> {
  provide: Token<T>;
  useExisting: Token<T>;
}

export type Provider<T = any> = ClassProvider<T> | ValueProvider<T> | FactoryProvider<T> | ExistingProvider<T>;
export type ProviderLike<T = any> = Provider<T> | Constructor<T>;

export interface DynamicModule {
  module: Constructor;
  imports?: ModuleImport[];
  providers?: ProviderLike[];
  controllers?: Constructor[];
  exports?: Array<Token | DynamicModule>;
  global?: boolean;
}

export type ModuleImport = ClassLike | DynamicModule | Promise<DynamicModule> | ForwardReference;

export interface ModuleMetadataOptions {
  imports?: ModuleImport[];
  providers?: ProviderLike[];
  controllers?: Constructor[];
  exports?: Array<Token | DynamicModule>;
  global?: boolean;
}

export function isValueProvider(p: Provider): p is ValueProvider {
  return 'useValue' in p;
}

export function isFactoryProvider(p: Provider): p is FactoryProvider {
  return 'useFactory' in p;
}

export function isClassProvider(p: Provider): p is ClassProvider {
  return 'useClass' in p;
}

export function isExistingProvider(p: Provider): p is ExistingProvider {
  return 'useExisting' in p;
}

export function isDynamicModule(value: unknown): value is DynamicModule {
  return typeof value === 'object' && value !== null && 'module' in (value as object);
}
