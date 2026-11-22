// Loads the reflect-metadata polyfill.
import '@drogonjs/common';
import type { Constructor } from '@drogonjs/common';

export type Dialect = 'postgres' | 'mysql' | 'sqlite';

export type ColumnType =
  | 'varchar'
  | 'char'
  | 'text'
  | 'uuid'
  | 'integer'
  | 'int'
  | 'smallint'
  | 'bigint'
  | 'real'
  | 'float'
  | 'double'
  | 'decimal'
  | 'numeric'
  | 'boolean'
  | 'timestamp'
  | 'timestamptz'
  | 'datetime'
  | 'date'
  | 'time'
  | 'json'
  | 'jsonb'
  | 'enum'
  | 'blob';

/** Columns maintained by the repository rather than set by the caller. */
export type ColumnMode = 'regular' | 'create-date' | 'update-date' | 'delete-date';

export interface ColumnOptions {
  type?: ColumnType;
  /** Database column name. Defaults to the property name. */
  name?: string;
  nullable?: boolean;
  /**
   * A literal becomes the column's DDL default, a function runs in the
   * application on insert, and a drizzle `sql` fragment is used verbatim.
   */
  default?: unknown;
  unique?: boolean;
  length?: number;
  precision?: number;
  scale?: number;
  /** Allowed values for `type: 'enum'`: an array or a TypeScript enum object. */
  enum?: readonly (string | number)[] | Record<string, string | number>;
  /** Postgres `timestamp with time zone`. */
  withTimezone?: boolean;
}

export interface ColumnMetadata {
  propertyName: string;
  databaseName: string;
  type: ColumnType;
  primary: boolean;
  generated?: 'increment' | 'uuid';
  nullable: boolean;
  unique: boolean;
  default?: unknown;
  length?: number;
  precision?: number;
  scale?: number;
  enumValues?: string[];
  withTimezone?: boolean;
  mode: ColumnMode;
  /** Set on join columns: the relation property this column stores the key for. */
  relationProperty?: string;
}

export type RelationKind = 'many-to-one' | 'one-to-many' | 'one-to-one';

export type OnDeleteAction = 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION' | 'SET DEFAULT';

export interface RelationOptions {
  nullable?: boolean;
  onDelete?: OnDeleteAction;
  onUpdate?: OnDeleteAction;
}

export interface JoinColumnOptions {
  /** Database name of the foreign-key column. Defaults to `<property>Id`. */
  name?: string;
  /** Property on the target entity the key references. Defaults to its primary column. */
  referencedColumnName?: string;
}

export type InverseSide = string | ((target: any) => unknown);

export interface RawRelation {
  propertyName: string;
  kind: RelationKind;
  target: () => Constructor;
  inverseSide?: InverseSide;
  options: RelationOptions;
}

export interface RawIndex {
  /** Property names. */
  columns: string[];
  name?: string;
  unique: boolean;
}

/** What the decorators record on each class, before relations are resolved. */
export interface RawEntityMetadata {
  tableName?: string;
  isEntity: boolean;
  columns: Map<string, ColumnMetadata>;
  relations: Map<string, RawRelation>;
  joinColumns: Map<string, JoinColumnOptions>;
  indices: RawIndex[];
}

const rawStore = new WeakMap<Function, RawEntityMetadata>();

export function rawMetadataOf(target: Function): RawEntityMetadata {
  let raw = rawStore.get(target);
  if (!raw) {
    raw = { isEntity: false, columns: new Map(), relations: new Map(), joinColumns: new Map(), indices: [] };
    rawStore.set(target, raw);
  }
  return raw;
}

export function isEntity(target: Function): boolean {
  return rawStore.get(target)?.isEntity === true;
}

export interface RelationMetadata {
  propertyName: string;
  kind: RelationKind;
  target: Constructor;
  /** True for the side holding the foreign key: many-to-one, or one-to-one with `@JoinColumn`. */
  owner: boolean;
  /** Owner side: the local column holding the key. */
  joinColumn?: ColumnMetadata;
  /** Owner side: the target column the key points at. */
  referencedColumn?: ColumnMetadata;
  /** Property name of the relation on the other entity, when declared. */
  inversePropertyName?: string;
  options: RelationOptions;
}

export interface IndexMetadata {
  name: string;
  columns: ColumnMetadata[];
  unique: boolean;
}

export interface EntityMetadata {
  target: Constructor;
  name: string;
  tableName: string;
  columns: ColumnMetadata[];
  primaryColumns: ColumnMetadata[];
  relations: RelationMetadata[];
  indices: IndexMetadata[];
  createDateColumn?: ColumnMetadata;
  updateDateColumn?: ColumnMetadata;
  deleteDateColumn?: ColumnMetadata;
  findColumn(propertyName: string): ColumnMetadata | undefined;
  findRelation(propertyName: string): RelationMetadata | undefined;
}

/** `UserProfile` -> `user_profile`, the TypeORM default table naming. */
export function defaultTableName(className: string): string {
  return className
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

const resolved = new WeakMap<Function, EntityMetadata>();

/** Base classes first, so a subclass can redeclare an inherited column. */
function chainOf(target: Function): Function[] {
  const chain: Function[] = [];
  let current: unknown = target;
  while (typeof current === 'function' && current !== Function.prototype) {
    chain.unshift(current as Function);
    current = Object.getPrototypeOf(current);
  }
  return chain;
}

/**
 * Resolves the metadata of an entity, adding the join columns its relations
 * need. Relations point at their targets through thunks, so this runs lazily
 * on first use rather than inside the decorators.
 */
export function getEntityMetadata(target: Function): EntityMetadata {
  const cached = resolved.get(target);
  if (cached) return cached;

  const raw = rawStore.get(target);
  if (!raw?.isEntity) {
    throw new Error(`[DrogonJS] ${target.name} is not an entity. Decorate it with @Entity().`);
  }

  const columns = new Map<string, ColumnMetadata>();
  const relations = new Map<string, RawRelation>();
  const joinColumns = new Map<string, JoinColumnOptions>();
  const rawIndices: RawIndex[] = [];
  for (const ctor of chainOf(target)) {
    const layer = rawStore.get(ctor);
    if (!layer) continue;
    for (const [key, column] of layer.columns) columns.set(key, { ...column });
    for (const [key, relation] of layer.relations) relations.set(key, relation);
    for (const [key, join] of layer.joinColumns) joinColumns.set(key, join);
    rawIndices.push(...layer.indices);
  }

  const metadata: EntityMetadata = {
    target: target as Constructor,
    name: target.name,
    tableName: raw.tableName ?? defaultTableName(target.name),
    columns: [],
    primaryColumns: [],
    relations: [],
    indices: [],
    findColumn: propertyName => metadata.columns.find(column => column.propertyName === propertyName),
    findRelation: propertyName => metadata.relations.find(relation => relation.propertyName === propertyName)
  };
  // Cached before relations resolve so self-referencing and mutually
  // referencing entities terminate.
  resolved.set(target, metadata);
  // Primary keys first, whichever class in the hierarchy declared them.
  metadata.columns = [...columns.values()].sort((a, b) => Number(b.primary) - Number(a.primary));

  for (const relation of relations.values()) {
    const relationTarget = relation.target();
    if (typeof relationTarget !== 'function') {
      throw new Error(
        `[DrogonJS] ${target.name}.${relation.propertyName} points at an undefined entity, which usually ` +
        'means a circular file import. Keep the target behind the () => Entity thunk.'
      );
    }
    const join = joinColumns.get(relation.propertyName);
    const owner = relation.kind === 'many-to-one' || (relation.kind === 'one-to-one' && join !== undefined);
    const resolvedRelation: RelationMetadata = {
      propertyName: relation.propertyName,
      kind: relation.kind,
      target: relationTarget,
      owner,
      inversePropertyName: inverseName(relation.inverseSide),
      options: relation.options
    };

    if (owner) {
      const targetMeta = relationTarget === target ? metadata : getEntityMetadata(relationTarget);
      const referenced = join?.referencedColumnName
        ? targetMeta.findColumn(join.referencedColumnName)
        : targetMeta.primaryColumns[0] ?? primaryOf(relationTarget);
      if (!referenced) {
        throw new Error(`[DrogonJS] ${target.name}.${relation.propertyName}: ${relationTarget.name} has no primary column to reference.`);
      }
      const databaseName = join?.name ?? `${relation.propertyName}Id`;
      // A column the entity declares itself, by property or database name,
      // doubles as the join column instead of being added a second time.
      let joinColumn = metadata.columns.find(
        column => column.databaseName === databaseName || column.propertyName === `${relation.propertyName}Id`
      );
      if (!joinColumn) {
        joinColumn = {
          propertyName: `${relation.propertyName}Id`,
          databaseName,
          type: referencedType(referenced),
          length: referenced.length,
          primary: false,
          nullable: relation.options.nullable ?? true,
          unique: relation.kind === 'one-to-one',
          mode: 'regular'
        };
        metadata.columns.push(joinColumn);
      }
      joinColumn.relationProperty = relation.propertyName;
      resolvedRelation.joinColumn = joinColumn;
      resolvedRelation.referencedColumn = referenced;
    }
    metadata.relations.push(resolvedRelation);
  }

  metadata.primaryColumns = metadata.columns.filter(column => column.primary);
  metadata.createDateColumn = metadata.columns.find(column => column.mode === 'create-date');
  metadata.updateDateColumn = metadata.columns.find(column => column.mode === 'update-date');
  metadata.deleteDateColumn = metadata.columns.find(column => column.mode === 'delete-date');

  for (const index of rawIndices) {
    const indexColumns = index.columns.map(name => {
      const column = metadata.findColumn(name) ?? metadata.findRelation(name)?.joinColumn;
      if (!column) throw new Error(`[DrogonJS] @Index on ${target.name} names unknown column "${name}".`);
      return column;
    });
    metadata.indices.push({
      name: index.name ?? `IDX_${metadata.tableName}_${indexColumns.map(column => column.databaseName).join('_')}`,
      columns: indexColumns,
      unique: index.unique
    });
  }

  return metadata;
}

/**
 * The primary column of an entity whose metadata is still being resolved
 * further up the stack (a self or mutual reference), before its
 * `primaryColumns` has been filled.
 */
function primaryOf(target: Function): ColumnMetadata | undefined {
  return resolved.get(target)?.columns.find(column => column.primary);
}

/** A foreign key mirrors the type of the key it references, minus generation. */
function referencedType(column: ColumnMetadata): ColumnType {
  if (column.generated === 'uuid') return 'uuid';
  return column.type;
}

function inverseName(side: InverseSide | undefined): string | undefined {
  if (side === undefined) return undefined;
  if (typeof side === 'string') return side;
  // `user => user.posts` is evaluated against a proxy that echoes the
  // property it is asked for.
  const echo = new Proxy({}, { get: (_target, key) => key });
  const name = side(echo);
  return typeof name === 'string' ? name : undefined;
}
