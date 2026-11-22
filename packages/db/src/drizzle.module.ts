import {
  Inject,
  Module,
  type Constructor,
  type DynamicModule,
  type ModuleImport,
  type Provider,
  type ProviderLike,
  type Token
} from '@drogonjs/common';
import { DataSource, type DataSourceOptions } from './data-source';
import { EntityManager } from './entity-manager';

export const DEFAULT_DATA_SOURCE_NAME = 'default';

export interface DrizzleModuleOptions extends DataSourceOptions {
  /** Distinguishes several data sources. Omit for the default one. */
  name?: string;
  /** Adds every entity passed to `forFeature` for this data source to `entities`. */
  autoLoadEntities?: boolean;
}

export interface DrizzleOptionsFactory {
  createDrizzleOptions(): DataSourceOptions & { autoLoadEntities?: boolean } | Promise<DataSourceOptions & { autoLoadEntities?: boolean }>;
}

export interface DrizzleModuleAsyncOptions {
  /** Fixed up front: the tokens it produces must be known before the factory runs. */
  name?: string;
  imports?: ModuleImport[];
  inject?: Token[];
  useFactory?: (...args: any[]) => Omit<DrizzleModuleOptions, 'name'> | Promise<Omit<DrizzleModuleOptions, 'name'>>;
  useClass?: Constructor<DrizzleOptionsFactory>;
  useExisting?: Token<DrizzleOptionsFactory>;
}

const symbols = new Map<string, symbol>();

function namedSymbol(key: string): symbol {
  let symbol = symbols.get(key);
  if (!symbol) {
    symbol = Symbol(key);
    symbols.set(key, symbol);
  }
  return symbol;
}

const isDefault = (name?: string) => name === undefined || name === DEFAULT_DATA_SOURCE_NAME;

/** The default data source is injectable by its class, so `constructor(ds: DataSource)` works. */
export function getDataSourceToken(name?: string): Token<DataSource> {
  return isDefault(name) ? DataSource : namedSymbol(`${name}DataSource`);
}

export function getEntityManagerToken(name?: string): Token<EntityManager> {
  return isDefault(name) ? EntityManager : namedSymbol(`${name}EntityManager`);
}

function getOptionsToken(name?: string): symbol {
  return namedSymbol(`${name ?? DEFAULT_DATA_SOURCE_NAME}DrizzleModuleOptions`);
}

const repositoryTokens = new WeakMap<Function, Map<string, symbol>>();

/** One token per entity and data source; entity class names need not be unique. */
export function getRepositoryToken(entity: Function, name: string = DEFAULT_DATA_SOURCE_NAME): symbol {
  let byName = repositoryTokens.get(entity);
  if (!byName) {
    byName = new Map();
    repositoryTokens.set(entity, byName);
  }
  let token = byName.get(name);
  if (!token) {
    token = Symbol(isDefault(name) ? `${entity.name}Repository` : `${name}${entity.name}Repository`);
    byName.set(name, token);
  }
  return token;
}

export const InjectRepository = (entity: Function, name?: string): ParameterDecorator =>
  Inject(getRepositoryToken(entity, name));

export const InjectDataSource = (name?: string): ParameterDecorator => Inject(getDataSourceToken(name));

export const InjectEntityManager = (name?: string): ParameterDecorator => Inject(getEntityManagerToken(name));

/**
 * Entities registered through `forFeature`, per data source. Module
 * definitions are evaluated before the application starts, so the data
 * source can pick these up for `autoLoadEntities` when it initializes.
 */
const featureEntities = new Map<string, Set<Constructor>>();

async function createDataSource(options: DrizzleModuleOptions, name?: string): Promise<DataSource> {
  const dataSource = new DataSource(options);
  if (options.autoLoadEntities) {
    dataSource.addEntities(featureEntities.get(name ?? DEFAULT_DATA_SOURCE_NAME) ?? []);
  }
  return dataSource.initialize();
}

function coreProviders(name: string | undefined, optionsProvider: Provider): Provider[] {
  const optionsToken = getOptionsToken(name);
  return [
    optionsProvider,
    {
      provide: getDataSourceToken(name),
      useFactory: (options: DrizzleModuleOptions) => createDataSource(options, name),
      inject: [optionsToken]
    },
    {
      provide: getEntityManagerToken(name),
      useFactory: (dataSource: DataSource) => dataSource.manager,
      inject: [getDataSourceToken(name)]
    }
  ];
}

@Module({})
export class DrizzleModule {
  /** Opens a data source and makes it injectable everywhere, like `TypeOrmModule.forRoot`. */
  static forRoot(options: DrizzleModuleOptions): DynamicModule {
    const name = options.name;
    return {
      module: DrizzleModule,
      global: true,
      providers: coreProviders(name, { provide: getOptionsToken(name), useValue: options }),
      exports: [getDataSourceToken(name), getEntityManagerToken(name)]
    };
  }

  static forRootAsync(options: DrizzleModuleAsyncOptions): DynamicModule {
    const name = options.name;
    const optionsToken = getOptionsToken(name);
    const extra: ProviderLike[] = [];
    let optionsProvider: Provider;

    if (options.useFactory) {
      optionsProvider = {
        provide: optionsToken,
        useFactory: async (...args: unknown[]) => ({ ...(await options.useFactory!(...args)), name }),
        inject: options.inject ?? []
      };
    } else if (options.useClass || options.useExisting) {
      const factoryToken = options.useExisting ?? options.useClass!;
      if (options.useClass) extra.push(options.useClass);
      optionsProvider = {
        provide: optionsToken,
        useFactory: async (factory: DrizzleOptionsFactory) => ({ ...(await factory.createDrizzleOptions()), name }),
        inject: [factoryToken]
      };
    } else {
      throw new Error('[DrogonJS] DrizzleModule.forRootAsync needs useFactory, useClass or useExisting.');
    }

    return {
      module: DrizzleModule,
      global: true,
      imports: options.imports ?? [],
      providers: [...extra, ...coreProviders(name, optionsProvider)],
      exports: [getDataSourceToken(name), getEntityManagerToken(name)]
    };
  }

  /** Provides `@InjectRepository(Entity)` for each entity, like `TypeOrmModule.forFeature`. */
  static forFeature(entities: Constructor[], name?: string): DynamicModule {
    const key = name ?? DEFAULT_DATA_SOURCE_NAME;
    const registered = featureEntities.get(key) ?? new Set();
    for (const entity of entities) registered.add(entity);
    featureEntities.set(key, registered);

    const providers: Provider[] = entities.map(entity => ({
      provide: getRepositoryToken(entity, name),
      useFactory: (dataSource: DataSource) => dataSource.getRepository(entity),
      inject: [getDataSourceToken(name)]
    }));
    return {
      module: DrizzleModule,
      providers,
      exports: providers.map(provider => provider.provide)
    };
  }
}
