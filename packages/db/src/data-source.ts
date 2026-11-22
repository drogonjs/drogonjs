import { sql, type SQL } from 'drizzle-orm';
import type { Logger } from 'drizzle-orm/logger';
import type { Constructor, OnApplicationShutdown } from '@drogonjs/common';
import { EntityManager } from './entity-manager';
import { getEntityMetadata, type Dialect, type EntityMetadata } from './metadata';
import type { Repository } from './repository';
import { createSchemaStatements } from './schema-sync';

export interface DataSourceOptions {
  dialect: Dialect;
  /**
   * A drizzle database you created yourself, for drivers other than the
   * defaults (pglite, node-postgres, libsql, ...). It is not closed by
   * `destroy()`, since this data source does not own it.
   */
  db?: any;
  /**
   * Connection string. The driver is created on `initialize()`: Bun SQL for
   * Postgres, `bun:sqlite` for SQLite (a file path or `:memory:`) and a
   * mysql2 pool for MySQL.
   */
  url?: string;
  /** Driver-specific connection options, used instead of `url`. */
  connection?: unknown;
  entities?: Constructor[];
  /** Creates missing tables on `initialize()`. Meant for development and tests. */
  synchronize?: boolean;
  /** `true` logs every query through drizzle's default logger. */
  logging?: boolean | Logger;
}

/** One database connection with its entities, like TypeORM's `DataSource`. */
export class DataSource implements OnApplicationShutdown {
  readonly dialect: Dialect;
  /** The drizzle database. Set once `initialize()` has run. */
  db: any;
  /** Repositories outside any transaction. */
  manager!: EntityManager;
  private readonly entities = new Set<Constructor>();
  private ownsClient = false;
  private initialized = false;

  constructor(readonly options: DataSourceOptions) {
    this.dialect = options.dialect;
    for (const entity of options.entities ?? []) this.entities.add(entity);
    if (options.db) this.bind(options.db);
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  get entityMetadatas(): EntityMetadata[] {
    return [...this.entities].map(entity => getEntityMetadata(entity));
  }

  /** Registers more entities, e.g. from `DrizzleModule.forFeature`, before `initialize()`. */
  addEntities(entities: Iterable<Constructor>): this {
    for (const entity of entities) this.entities.add(entity);
    return this;
  }

  async initialize(): Promise<this> {
    if (this.initialized) return this;
    if (!this.db) {
      this.bind(await createDriver(this.options));
      this.ownsClient = true;
    }
    // TypeORM's SQLite driver turns this on too; SQLite ignores FKs otherwise.
    if (this.dialect === 'sqlite') await this.execute('PRAGMA foreign_keys = ON');
    if (this.options.synchronize) await this.synchronize();
    this.initialized = true;
    return this;
  }

  getRepository<T extends object>(target: Constructor<T>): Repository<T> {
    return this.manager.getRepository(target);
  }

  transaction<R>(work: (manager: EntityManager) => Promise<R>): Promise<R> {
    return this.manager.transaction(work);
  }

  /** Creates the tables of every registered entity that do not exist yet. */
  async synchronize(): Promise<void> {
    for (const statement of createSchemaStatements([...this.entities], this.dialect)) {
      await this.execute(statement);
    }
  }

  /** Runs raw SQL and returns the rows it produced, if any. */
  async query<R = Record<string, unknown>>(statement: string | SQL): Promise<R[]> {
    const query = typeof statement === 'string' ? sql.raw(statement) : statement;
    if (this.dialect === 'sqlite') return this.db.all(query);
    const result = await this.db.execute(query);
    if (this.dialect === 'mysql') return Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : []) : [];
    // Bun SQL returns the rows; node-postgres and pglite wrap them in `rows`.
    return Array.isArray(result) ? result : result?.rows ?? [];
  }

  /** Closes the connection if this data source opened it. */
  async destroy(): Promise<void> {
    if (!this.initialized) return;
    this.initialized = false;
    if (!this.ownsClient) return;
    const client = this.db?.$client;
    if (!client) return;
    if (this.dialect === 'mysql') {
      await new Promise<void>((resolve, reject) => {
        const result = client.end((error?: Error) => (error ? reject(error) : resolve()));
        if (result && typeof result.then === 'function') result.then(() => resolve(), reject);
      });
    } else {
      await client.close?.();
    }
  }

  onApplicationShutdown(): Promise<void> {
    return this.destroy();
  }

  /** @internal */
  async runTransaction<R>(manager: EntityManager, work: (manager: EntityManager) => Promise<R>): Promise<R> {
    if (this.dialect !== 'sqlite') {
      return manager.db.transaction((tx: any) => work(new EntityManager(this, tx, manager.depth + 1)));
    }
    // drizzle's bun:sqlite transactions are synchronous and cannot await, so
    // SQLite transactions are driven by hand. The connection is shared: other
    // queries issued while one is open join it.
    const savepoint = manager.depth === 0 ? undefined : `drogon_sp_${manager.depth}`;
    await this.execute(savepoint ? `SAVEPOINT ${savepoint}` : 'BEGIN');
    try {
      const result = await work(new EntityManager(this, manager.db, manager.depth + 1));
      await this.execute(savepoint ? `RELEASE ${savepoint}` : 'COMMIT');
      return result;
    } catch (error) {
      await this.execute(savepoint ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
      if (savepoint) await this.execute(`RELEASE ${savepoint}`);
      throw error;
    }
  }

  private bind(db: any) {
    this.db = db;
    this.manager = new EntityManager(this, db);
  }

  private async execute(statement: string): Promise<void> {
    const query = sql.raw(statement);
    if (this.dialect === 'sqlite') await this.db.run(query);
    else await this.db.execute(query);
  }
}

async function createDriver(options: DataSourceOptions): Promise<any> {
  const logger = options.logging;
  const connection = options.url ?? options.connection;

  switch (options.dialect) {
    case 'postgres': {
      if (connection === undefined) throw new Error('[DrogonJS] A Postgres data source needs `url`, `connection` or `db`.');
      const { drizzle } = await import('drizzle-orm/bun-sql');
      return drizzle({ connection: connection as any, logger });
    }
    case 'mysql': {
      if (connection === undefined) throw new Error('[DrogonJS] A MySQL data source needs `url`, `connection` or `db`.');
      const { drizzle } = await import('drizzle-orm/mysql2');
      return drizzle({ connection: connection as any, mode: 'default', logger });
    }
    case 'sqlite': {
      const { Database } = await import('bun:sqlite');
      const { drizzle } = await import('drizzle-orm/bun-sqlite');
      const path = typeof connection === 'string' ? connection.replace(/^(sqlite:\/\/|file:)/, '') : ':memory:';
      return drizzle(new Database(path), { logger });
    }
  }
}
