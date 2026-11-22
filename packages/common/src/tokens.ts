export type Constructor<T = any> = new (...args: any[]) => T;
export type AbstractConstructor<T = any> = abstract new (...args: any[]) => T;
export type ClassLike<T = any> = Constructor<T> | AbstractConstructor<T>;
export type Token<T = any> = ClassLike<T> | string | symbol;

export function createToken<T>(description: string): symbol & { __type?: T } {
  return Symbol(description) as symbol & { __type?: T };
}

export function tokenName(token: Token): string {
  if (typeof token === 'function') return token.name;
  if (typeof token === 'symbol') return token.description ?? token.toString();
  return String(token);
}

/**
 * Resolves to the platform's request object inside request-scoped providers.
 * Injecting it makes the consumer request-scoped as well.
 */
export const REQUEST = Symbol.for('drogonjs:REQUEST');

/**
 * Providers registered under these tokens, in any module, become global
 * enhancers that are built by that module's container and so can inject its
 * providers. Each registration adds one enhancer; they never replace each other.
 */
export const APP_GUARD = Symbol.for('drogonjs:APP_GUARD');
export const APP_INTERCEPTOR = Symbol.for('drogonjs:APP_INTERCEPTOR');
export const APP_PIPE = Symbol.for('drogonjs:APP_PIPE');
export const APP_FILTER = Symbol.for('drogonjs:APP_FILTER');

export interface ForwardReference<T = any> {
  forwardRef: () => T;
}

/**
 * Defers reading a class until it is needed, for dependencies and imports whose
 * binding is still `undefined` when the decorator runs because of a circular
 * file import. On a provider dependency it also lets two singletons depend on
 * each other: the one created second receives the first before its constructor
 * has run, so it must not be used from inside that constructor.
 */
export function forwardRef<T = any>(fn: () => T): ForwardReference<T> {
  return { forwardRef: fn };
}

export function isForwardReference(value: unknown): value is ForwardReference {
  return typeof value === 'object' && value !== null && typeof (value as ForwardReference).forwardRef === 'function';
}
