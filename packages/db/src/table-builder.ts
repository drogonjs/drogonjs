import { SQL, sql } from 'drizzle-orm';
import * as pg from 'drizzle-orm/pg-core';
import * as my from 'drizzle-orm/mysql-core';
import * as lite from 'drizzle-orm/sqlite-core';
import type { Constructor } from '@drogonjs/common';
import { getEntityMetadata, type ColumnMetadata, type Dialect, type EntityMetadata } from './metadata';

/** A drizzle table whose columns are keyed by entity property name. */
export type EntityTable = pg.PgTable | my.MySqlTable | lite.SQLiteTable;

const tables = new Map<Dialect, WeakMap<Function, any>>();

const now = () => new Date();
const randomUUID = () => crypto.randomUUID();

/**
 * Builds the drizzle table for an entity in the given dialect. Keys are
 * property names, column names are database names, so the result can be used
 * with drizzle's own query builder or exported for drizzle-kit.
 */
export function toTable(entity: Function, dialect: Dialect): any {
  let cache = tables.get(dialect);
  if (!cache) {
    cache = new WeakMap();
    tables.set(dialect, cache);
  }
  const hit = cache.get(entity);
  if (hit) return hit;

  const metadata = getEntityMetadata(entity);
  const builders: Record<string, any> = {};
  for (const column of metadata.columns) {
    builders[column.propertyName] = finishColumn(buildColumn(column, dialect), column, metadata, dialect);
  }
  addReferences(builders, metadata, dialect);

  const extra = (table: any) => {
    const config: any[] = [];
    const primaryKeys = metadata.primaryColumns;
    if (primaryKeys.length > 1) {
      const primaryKey = dialect === 'postgres' ? pg.primaryKey : dialect === 'mysql' ? my.primaryKey : lite.primaryKey;
      config.push(primaryKey({ columns: primaryKeys.map(column => table[column.propertyName]) as [any, ...any[]] }));
    }
    for (const index of metadata.indices) {
      const factory =
        dialect === 'postgres'
          ? index.unique ? pg.uniqueIndex : pg.index
          : dialect === 'mysql'
            ? index.unique ? my.uniqueIndex : my.index
            : index.unique ? lite.uniqueIndex : lite.index;
      const [first, ...rest] = index.columns.map(column => table[column.propertyName]);
      config.push((factory(index.name) as any).on(first, ...rest));
    }
    return config;
  };

  const table =
    dialect === 'postgres'
      ? pg.pgTable(metadata.tableName, builders, extra)
      : dialect === 'mysql'
        ? my.mysqlTable(metadata.tableName, builders, extra)
        : lite.sqliteTable(metadata.tableName, builders, extra);
  cache.set(entity, table);
  return table;
}

/**
 * Tables for several entities, keyed by class name:
 * `export const { User, Post } = buildSchema([User, Post], 'postgres')`.
 */
export function buildSchema(entities: Constructor[], dialect: Dialect): Record<string, any> {
  return Object.fromEntries(entities.map(entity => [entity.name, toTable(entity, dialect)]));
}

function buildColumn(column: ColumnMetadata, dialect: Dialect): any {
  const name = column.databaseName;
  const increment = column.generated === 'increment';

  if (dialect === 'postgres') {
    if (increment) return column.type === 'bigint' ? pg.bigserial(name, { mode: 'number' }) : pg.serial(name);
    switch (column.type) {
      case 'varchar':
        return pg.varchar(name, { length: column.length ?? 255 });
      case 'char':
        return pg.char(name, { length: column.length ?? 1 });
      case 'text':
        return pg.text(name);
      case 'enum':
        return pg.varchar(name, { length: column.length ?? 255, enum: column.enumValues as [string, ...string[]] });
      case 'uuid':
        return pg.uuid(name);
      case 'integer':
      case 'int':
        return pg.integer(name);
      case 'smallint':
        return pg.smallint(name);
      case 'bigint':
        return pg.bigint(name, { mode: 'number' });
      case 'real':
      case 'float':
        return pg.real(name);
      case 'double':
        return pg.doublePrecision(name);
      case 'decimal':
      case 'numeric':
        return pg.numeric(name, { precision: column.precision, scale: column.scale } as any);
      case 'boolean':
        return pg.boolean(name);
      case 'timestamptz':
        return pg.timestamp(name, { mode: 'date', withTimezone: true });
      case 'timestamp':
      case 'datetime':
        return pg.timestamp(name, { mode: 'date', withTimezone: column.withTimezone ?? false });
      case 'date':
        return pg.date(name);
      case 'time':
        return pg.time(name);
      case 'json':
        return pg.json(name);
      case 'jsonb':
        return pg.jsonb(name);
      case 'blob':
        return pg.customType<{ data: Uint8Array }>({ dataType: () => 'bytea' })(name);
    }
  }

  if (dialect === 'mysql') {
    if (increment) {
      const base = column.type === 'bigint' ? my.bigint(name, { mode: 'number' }) : my.int(name);
      return base.autoincrement();
    }
    switch (column.type) {
      case 'varchar':
        return my.varchar(name, { length: column.length ?? 255 });
      case 'char':
        return my.char(name, { length: column.length ?? 1 });
      case 'text':
        return my.text(name);
      case 'enum':
        return my.mysqlEnum(name, column.enumValues as [string, ...string[]]);
      case 'uuid':
        return my.varchar(name, { length: 36 });
      case 'integer':
      case 'int':
        return my.int(name);
      case 'smallint':
        return my.smallint(name);
      case 'bigint':
        return my.bigint(name, { mode: 'number' });
      case 'real':
      case 'float':
        return my.float(name);
      case 'double':
        return my.double(name);
      case 'decimal':
      case 'numeric':
        return my.decimal(name, { precision: column.precision, scale: column.scale });
      case 'boolean':
        return my.boolean(name);
      case 'timestamp':
      case 'timestamptz':
        return my.timestamp(name, { mode: 'date', fsp: 3 });
      case 'datetime':
        return my.datetime(name, { mode: 'date', fsp: 3 });
      case 'date':
        return my.date(name);
      case 'time':
        return my.time(name);
      case 'json':
      case 'jsonb':
        return my.json(name);
      case 'blob':
        return my.customType<{ data: Uint8Array }>({ dataType: () => 'blob' })(name);
    }
  }

  // SQLite has five storage classes; dates are kept as epoch milliseconds so
  // they round-trip as `Date` like on the other dialects.
  if (increment) return lite.integer(name, { mode: 'number' });
  switch (column.type) {
    case 'varchar':
    case 'char':
    case 'text':
    case 'uuid':
    case 'time':
      return lite.text(name);
    case 'enum':
      return lite.text(name, { enum: column.enumValues as [string, ...string[]] });
    case 'integer':
    case 'int':
    case 'smallint':
    case 'bigint':
      return lite.integer(name, { mode: 'number' });
    case 'real':
    case 'float':
    case 'double':
      return lite.real(name);
    case 'decimal':
    case 'numeric':
      return lite.numeric(name);
    case 'boolean':
      return lite.integer(name, { mode: 'boolean' });
    case 'timestamp':
    case 'timestamptz':
    case 'datetime':
    case 'date':
      return lite.integer(name, { mode: 'timestamp_ms' });
    case 'json':
    case 'jsonb':
      return lite.text(name, { mode: 'json' });
    case 'blob':
      return lite.blob(name, { mode: 'buffer' });
  }
  throw new Error(`[DrogonJS] Unsupported column type "${column.type}" for ${dialect}.`);
}

function finishColumn(builder: any, column: ColumnMetadata, metadata: EntityMetadata, dialect: Dialect): any {
  if (column.primary && metadata.primaryColumns.length === 1) {
    builder = dialect === 'sqlite' && column.generated === 'increment'
      ? builder.primaryKey({ autoIncrement: true })
      : builder.primaryKey();
  } else if (column.primary || !column.nullable) {
    builder = builder.notNull();
  }
  if (column.unique && !column.primary) builder = builder.unique();

  if (column.generated === 'uuid') {
    builder = dialect === 'postgres' ? builder.defaultRandom() : builder.$defaultFn(randomUUID);
  }

  if (column.mode === 'create-date' || column.mode === 'update-date') {
    if (dialect === 'sqlite') builder = builder.$defaultFn(now);
    // MySQL rejects a default whose precision differs from the column's.
    else if (dialect === 'mysql') builder = builder.default(sql`CURRENT_TIMESTAMP(3)`);
    else builder = builder.defaultNow();
    if (column.mode === 'update-date') builder = builder.$onUpdate(now);
  }

  if (column.default !== undefined) {
    builder = typeof column.default === 'function' && !(column.default instanceof SQL)
      ? builder.$defaultFn(column.default)
      : builder.default(column.default);
  }
  return builder;
}

/** Declares foreign keys on the drizzle table too, so drizzle-kit sees them. */
function addReferences(builders: Record<string, any>, metadata: EntityMetadata, dialect: Dialect) {
  for (const relation of metadata.relations) {
    if (!relation.owner || !relation.joinColumn || !relation.referencedColumn) continue;
    const key = relation.joinColumn.propertyName;
    const referenced = relation.referencedColumn.propertyName;
    const target = relation.target;
    const actions = {
      onDelete: relation.options.onDelete?.toLowerCase() as any,
      onUpdate: relation.options.onUpdate?.toLowerCase() as any
    };
    builders[key] = builders[key].references(() => toTable(target, dialect)[referenced], actions);
  }
}
