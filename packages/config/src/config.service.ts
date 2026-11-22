import { Inject, Injectable, Optional } from '@drogonjs/common';
import { CONFIGURATION_TOKEN, VALIDATED_ENV_TOKEN, type ConfigOptionsState } from './tokens';

type Path<T> = T extends Record<string, unknown>
  ? { [K in keyof T & string]: T[K] extends Record<string, unknown> ? K | `${K}.${Path<T[K]>}` : K }[keyof T & string]
  : string;

type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? PathValue<T[K], Rest>
    : unknown
  : P extends keyof T
    ? T[P]
    : unknown;

/**
 * Reads configuration by key or dotted path. Looks in the validated
 * environment first (when `validate` was given), then `process.env`, then
 * the values from `load` and `registerAs` factories.
 */
@Injectable()
export class ConfigService<TConfig extends Record<string, unknown> = Record<string, any>> {
  private readonly cache = new Map<string, unknown>();

  constructor(
    @Optional() @Inject(CONFIGURATION_TOKEN) private readonly internalConfig: Record<string, unknown> = {},
    @Optional() @Inject(VALIDATED_ENV_TOKEN) private readonly state: ConfigOptionsState = {}
  ) {}

  get<P extends Path<TConfig>>(path: P): PathValue<TConfig, P> | undefined;
  get<P extends Path<TConfig>>(path: P, defaultValue: NonNullable<PathValue<TConfig, P>>): NonNullable<PathValue<TConfig, P>>;
  get<T = any>(path: string, defaultValue?: T): T | undefined;
  get(path: string, defaultValue?: unknown): unknown {
    if (this.state.cache && this.cache.has(path)) return this.cache.get(path);
    const value = this.lookup(path);
    if (value === undefined) return defaultValue;
    if (this.state.cache) this.cache.set(path, value);
    return value;
  }

  getOrThrow<P extends Path<TConfig>>(path: P, defaultValue?: NonNullable<PathValue<TConfig, P>>): NonNullable<PathValue<TConfig, P>>;
  getOrThrow<T = any>(path: string, defaultValue?: T): T;
  getOrThrow(path: string, defaultValue?: unknown): unknown {
    const value = this.get(path, defaultValue as never);
    if (value === undefined) throw new TypeError(`[DrogonJS] Configuration key "${path}" does not exist`);
    return value;
  }

  /** Sets a value for the life of this application; `process.env` is left alone. */
  set(path: string, value: unknown) {
    this.cache.delete(path);
    setPath(this.internalConfig, path, value);
    if (this.state.validatedEnv && path in this.state.validatedEnv) this.state.validatedEnv[path] = value;
  }

  private lookup(path: string): unknown {
    const validated = this.state.validatedEnv;
    if (validated) {
      const value = getPath(validated, path);
      if (value !== undefined) return value;
    }
    if (!this.state.skipProcessEnv && typeof process !== 'undefined') {
      const value = process.env[path];
      if (value !== undefined) return value;
    }
    return getPath(this.internalConfig, path);
  }
}

export function getPath(source: Record<string, unknown>, path: string): unknown {
  if (path in source) return source[path];
  let current: unknown = source;
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.');
  let current = target;
  for (const part of parts.slice(0, -1)) {
    if (typeof current[part] !== 'object' || current[part] === null) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts.at(-1)!] = value;
}
