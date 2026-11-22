import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Module, type DynamicModule, type Provider } from '@drogonjs/common';
import { ConfigService } from './config.service';
import { expandVariables, parseDotenv } from './dotenv';
import { isNamespaced, namespaceProvider, type ConfigFactory, type NamespacedConfigFactory } from './register-as';
import { CONFIGURATION_TOKEN, VALIDATED_ENV_TOKEN, type ConfigOptionsState } from './tokens';

/** Standard Schema (Zod, Valibot, ArkType, …), as accepted by `validationSchema`. */
interface StandardSchema {
  readonly '~standard': {
    validate(value: unknown): { value?: unknown; issues?: ReadonlyArray<{ message: string; path?: ReadonlyArray<unknown> }> }
      | Promise<{ value?: unknown; issues?: ReadonlyArray<{ message: string; path?: ReadonlyArray<unknown> }> }>;
  };
}

export interface ConfigModuleOptions {
  /** Makes `ConfigService` injectable everywhere without importing the module. */
  isGlobal?: boolean;
  /** Read in order; the first file to define a key wins. Defaults to `.env`. */
  envFilePath?: string | string[];
  ignoreEnvFile?: boolean;
  /** Do not read `process.env` in `ConfigService.get`. */
  ignoreEnvVars?: boolean;
  /** Configuration factories; `registerAs` factories land under their namespace. */
  load?: Array<ConfigFactory<any>>;
  /** Receives the environment and returns it validated (and possibly converted), or throws. */
  validate?: (config: Record<string, unknown>) => Record<string, unknown>;
  /** A Standard Schema the environment must satisfy; its output replaces it. */
  validationSchema?: StandardSchema;
  /** Expands `${VAR}` references inside env files. */
  expandVariables?: boolean;
  /** Caches values read through `ConfigService.get`. */
  cache?: boolean;
}

@Module({})
export class ConfigModule {
  static forRoot(options: ConfigModuleOptions = {}): DynamicModule {
    const fileValues = options.ignoreEnvFile ? {} : loadEnvFiles(options);
    // As with dotenv, the real environment wins over files, and files fill the gaps in it.
    for (const [key, value] of Object.entries(fileValues)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }

    const load = options.load ?? [];
    const providers: Provider[] = [
      {
        provide: VALIDATED_ENV_TOKEN,
        useFactory: async (): Promise<ConfigOptionsState> => {
          const env = options.ignoreEnvVars ? { ...fileValues } : { ...fileValues, ...process.env };
          let validatedEnv: Record<string, unknown> | undefined;
          if (options.validationSchema) validatedEnv = await validateWithSchema(options.validationSchema, env);
          if (options.validate) validatedEnv = options.validate(validatedEnv ?? env);
          return { validatedEnv, cache: options.cache, skipProcessEnv: options.ignoreEnvVars };
        }
      },
      {
        provide: CONFIGURATION_TOKEN,
        useFactory: async () => {
          const configuration: Record<string, unknown> = {};
          for (const factory of load) {
            const value = await factory();
            if (isNamespaced(factory)) configuration[factory.NAMESPACE] = value;
            else Object.assign(configuration, value);
          }
          return configuration;
        }
      },
      ...load.filter(isNamespaced).map(factory => namespaceProvider(factory, false))
    ];

    return {
      module: ConfigModule,
      global: options.isGlobal,
      providers: [...providers, ConfigService],
      exports: [ConfigService, CONFIGURATION_TOKEN, VALIDATED_ENV_TOKEN, ...load.filter(isNamespaced).map(factory => factory.KEY)]
    };
  }

  /**
   * Adds a `registerAs` namespace from a feature module. Its values join the
   * configuration `ConfigService` reads and are injectable through `KEY`.
   */
  static forFeature(factory: NamespacedConfigFactory<any>): DynamicModule {
    return {
      module: ConfigModule,
      providers: [namespaceProvider(factory, true)],
      exports: [factory.KEY]
    };
  }
}

function loadEnvFiles(options: ConfigModuleOptions): Record<string, string> {
  const paths = options.envFilePath === undefined ? ['.env'] : [options.envFilePath].flat();
  let values: Record<string, string> = {};
  for (const path of paths) {
    const absolute = resolve(process.cwd(), path);
    if (!existsSync(absolute)) continue;
    values = { ...parseDotenv(readFileSync(absolute, 'utf8')), ...values };
  }
  return options.expandVariables ? expandVariables(values, process.env) : values;
}

async function validateWithSchema(schema: StandardSchema, env: Record<string, unknown>) {
  const result = await schema['~standard'].validate(env);
  if (result.issues) {
    const details = result.issues
      .map(issue => `${(issue.path ?? []).map(part => String((part as { key?: unknown })?.key ?? part)).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`[DrogonJS] Config validation error: ${details}`);
  }
  return result.value as Record<string, unknown>;
}
