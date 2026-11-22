/** The merged values of `load` and `registerAs` factories. */
export const CONFIGURATION_TOKEN = Symbol.for('drogonjs:config:configuration');
/** Settings that shape lookups: the validated environment, caching, process.env access. */
export const VALIDATED_ENV_TOKEN = Symbol.for('drogonjs:config:state');

export interface ConfigOptionsState {
  validatedEnv?: Record<string, unknown>;
  cache?: boolean;
  skipProcessEnv?: boolean;
}
