import { SQL } from 'drizzle-orm';
import { PgDialect, getTableConfig as pgConfig } from 'drizzle-orm/pg-core';
import { MySqlDialect, getTableConfig as myConfig } from 'drizzle-orm/mysql-core';
import { SQLiteSyncDialect, getTableConfig as liteConfig } from 'drizzle-orm/sqlite-core';
import { getEntityMetadata, type Dialect, type EntityMetadata } from './metadata';
import { toTable } from './table-builder';

function quote(identifier: string, dialect: Dialect): string {
  return dialect === 'mysql' ? `\`${identifier.replace(/`/g, '``')}\`` : `"${identifier.replace(/"/g, '""')}"`;
}

const sqlDialects = {
  postgres: new PgDialect(),
  mysql: new MySqlDialect(),
  sqlite: new SQLiteSyncDialect()
};

function renderDefault(value: unknown, dialect: Dialect): string {
  if (value instanceof SQL) return sqlDialects[dialect].sqlToQuery(value as any).sql;
  if (value === null) return 'NULL';
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return dialect === 'sqlite' ? (value ? '1' : '0') : String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return `'${text.replace(/'/g, "''")}'`;
}

/** The entities plus every entity they reach through relations. */
function withRelated(entities: Function[]): EntityMetadata[] {
  const seen = new Map<Function, EntityMetadata>();
  const visit = (entity: Function) => {
    if (seen.has(entity)) return;
    const metadata = getEntityMetadata(entity);
    seen.set(entity, metadata);
    for (const relation of metadata.relations) visit(relation.target);
  };
  entities.forEach(visit);
  return [...seen.values()];
}

/** Referenced tables first, so foreign keys always point at an existing table. */
function sortByDependency(entities: EntityMetadata[]): EntityMetadata[] {
  const ordered: EntityMetadata[] = [];
  const state = new Map<EntityMetadata, 'visiting' | 'done'>();
  const byTarget = new Map(entities.map(metadata => [metadata.target as Function, metadata]));
  const visit = (metadata: EntityMetadata) => {
    // A reference cycle cannot be ordered; its tables keep declaration order.
    if (state.has(metadata)) return;
    state.set(metadata, 'visiting');
    for (const relation of metadata.relations) {
      const target = byTarget.get(relation.target);
      if (relation.owner && target && target !== metadata) visit(target);
    }
    state.set(metadata, 'done');
    ordered.push(metadata);
  };
  entities.forEach(visit);
  return ordered;
}

/**
 * `CREATE TABLE IF NOT EXISTS` statements (plus indexes) for the entities and
 * everything they relate to. Existing tables are left as they are: this is
 * the development-time `synchronize`, not a migration tool.
 */
export function createSchemaStatements(entities: Function[], dialect: Dialect): string[] {
  const statements: string[] = [];
  const q = (identifier: string) => quote(identifier, dialect);

  for (const metadata of sortByDependency(withRelated(entities))) {
    const table = toTable(metadata.target, dialect);
    const config: any = dialect === 'postgres' ? pgConfig(table) : dialect === 'mysql' ? myConfig(table) : liteConfig(table);
    const definitions: string[] = [];

    for (const column of config.columns) {
      const parts = [q(column.name), column.getSQLType()];
      if (column.notNull) parts.push('NOT NULL');
      else if (dialect === 'mysql') parts.push('NULL');
      if (column.default !== undefined) parts.push(`DEFAULT ${renderDefault(column.default, dialect)}`);
      if (dialect === 'mysql' && metadata.updateDateColumn?.databaseName === column.name) {
        parts.push('ON UPDATE CURRENT_TIMESTAMP(3)');
      }
      if (dialect === 'mysql' && column.autoIncrement) parts.push('AUTO_INCREMENT');
      if (column.isUnique) parts.push('UNIQUE');
      if (column.primary) {
        parts.push('PRIMARY KEY');
        if (dialect === 'sqlite' && column.autoIncrement) parts.push('AUTOINCREMENT');
      }
      definitions.push(parts.join(' '));
    }

    if (metadata.primaryColumns.length > 1) {
      definitions.push(`PRIMARY KEY (${metadata.primaryColumns.map(column => q(column.databaseName)).join(', ')})`);
    }

    for (const relation of metadata.relations) {
      if (!relation.owner || !relation.joinColumn || !relation.referencedColumn) continue;
      const target = getEntityMetadata(relation.target);
      let constraint =
        `CONSTRAINT ${q(`FK_${metadata.tableName}_${relation.joinColumn.databaseName}`)} ` +
        `FOREIGN KEY (${q(relation.joinColumn.databaseName)}) ` +
        `REFERENCES ${q(target.tableName)} (${q(relation.referencedColumn.databaseName)})`;
      if (relation.options.onDelete) constraint += ` ON DELETE ${relation.options.onDelete}`;
      if (relation.options.onUpdate) constraint += ` ON UPDATE ${relation.options.onUpdate}`;
      definitions.push(constraint);
    }

    // MySQL has no CREATE INDEX IF NOT EXISTS, so its indexes live in the table body.
    if (dialect === 'mysql') {
      for (const index of metadata.indices) {
        const columns = index.columns.map(column => q(column.databaseName)).join(', ');
        definitions.push(`${index.unique ? 'UNIQUE KEY' : 'KEY'} ${q(index.name)} (${columns})`);
      }
    }

    statements.push(`CREATE TABLE IF NOT EXISTS ${q(metadata.tableName)} (\n  ${definitions.join(',\n  ')}\n)`);

    if (dialect !== 'mysql') {
      for (const index of metadata.indices) {
        const columns = index.columns.map(column => q(column.databaseName)).join(', ');
        statements.push(
          `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${q(index.name)} ON ${q(metadata.tableName)} (${columns})`
        );
      }
    }
  }

  return statements;
}
