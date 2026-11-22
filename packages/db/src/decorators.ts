// Loads the reflect-metadata polyfill.
import '@drogonjs/common';
import type { Constructor } from '@drogonjs/common';
import {
  rawMetadataOf,
  type ColumnMetadata,
  type ColumnMode,
  type ColumnOptions,
  type ColumnType,
  type InverseSide,
  type JoinColumnOptions,
  type RelationKind,
  type RelationOptions
} from './metadata';

export interface EntityOptions {
  /** Table name. Defaults to the snake_cased class name. */
  name?: string;
}

export function Entity(nameOrOptions?: string | EntityOptions): ClassDecorator {
  return target => {
    const raw = rawMetadataOf(target);
    raw.isEntity = true;
    const name = typeof nameOrOptions === 'string' ? nameOrOptions : nameOrOptions?.name;
    if (name) raw.tableName = name;
  };
}

/** Maps the TypeScript type TypeScript emitted for a property to a column type. */
function inferType(target: object, propertyKey: string): ColumnType {
  const designType = Reflect.getMetadata('design:type', target, propertyKey);
  switch (designType) {
    case String:
      return 'varchar';
    case Number:
      return 'integer';
    case Boolean:
      return 'boolean';
    case Date:
      return 'timestamp';
    default:
      // Objects, arrays, unions and interfaces all compile to something that
      // names no scalar type; JSON is the only column that holds any of them.
      return 'json';
  }
}

function enumValues(values: ColumnOptions['enum']): string[] | undefined {
  if (!values) return undefined;
  const list = Array.isArray(values)
    ? values
    : // Numeric TypeScript enums also map each value back to its name.
      Object.entries(values as Record<string, string | number>)
        .filter(([key]) => Number.isNaN(Number(key)))
        .map(([, value]) => value);
  return list.map(String);
}

function defineColumn(
  target: object,
  propertyKey: string | symbol,
  options: ColumnOptions,
  extra: Partial<ColumnMetadata> & { mode?: ColumnMode } = {}
) {
  if (typeof propertyKey !== 'string') {
    throw new Error('[DrogonJS] Entity columns must be declared on string-named properties.');
  }
  const type = options.type ?? extra.type ?? inferType(target, propertyKey);
  const column: ColumnMetadata = {
    propertyName: propertyKey,
    databaseName: options.name ?? propertyKey,
    type,
    primary: false,
    nullable: options.nullable ?? false,
    unique: options.unique ?? false,
    default: options.default,
    length: options.length,
    precision: options.precision,
    scale: options.scale,
    enumValues: enumValues(options.enum),
    withTimezone: options.withTimezone,
    mode: 'regular',
    ...extra,
    // `extra.type` is a fallback only; an explicit `options.type` wins.
    ...(options.type ? { type: options.type } : {})
  };
  rawMetadataOf(target.constructor).columns.set(propertyKey, column);
}

export function Column(typeOrOptions?: ColumnType | ColumnOptions, maybeOptions: ColumnOptions = {}): PropertyDecorator {
  const options = typeof typeOrOptions === 'string' ? { ...maybeOptions, type: typeOrOptions } : typeOrOptions ?? {};
  return (target, propertyKey) => defineColumn(target, propertyKey, options);
}

export function PrimaryColumn(typeOrOptions?: ColumnType | ColumnOptions, maybeOptions: ColumnOptions = {}): PropertyDecorator {
  const options = typeof typeOrOptions === 'string' ? { ...maybeOptions, type: typeOrOptions } : typeOrOptions ?? {};
  return (target, propertyKey) => defineColumn(target, propertyKey, options, { primary: true });
}

export type PrimaryGeneratedColumnStrategy = 'increment' | 'uuid';

export function PrimaryGeneratedColumn(
  strategyOrOptions?: PrimaryGeneratedColumnStrategy | Omit<ColumnOptions, 'type' | 'nullable'>,
  maybeOptions: Omit<ColumnOptions, 'type' | 'nullable'> = {}
): PropertyDecorator {
  const strategy = typeof strategyOrOptions === 'string' ? strategyOrOptions : 'increment';
  const options = typeof strategyOrOptions === 'object' ? strategyOrOptions : maybeOptions;
  return (target, propertyKey) =>
    defineColumn(target, propertyKey, options, {
      primary: true,
      generated: strategy,
      type: strategy === 'uuid' ? 'uuid' : 'integer'
    });
}

type DateColumnOptions = Omit<ColumnOptions, 'type' | 'enum' | 'length'> & { type?: 'timestamp' | 'timestamptz' | 'datetime' };

/** Set when the row is inserted. */
export function CreateDateColumn(options: DateColumnOptions = {}): PropertyDecorator {
  return (target, propertyKey) =>
    defineColumn(target, propertyKey, options, { mode: 'create-date', type: 'timestamp' });
}

/** Set on insert and refreshed by every repository update. */
export function UpdateDateColumn(options: DateColumnOptions = {}): PropertyDecorator {
  return (target, propertyKey) =>
    defineColumn(target, propertyKey, options, { mode: 'update-date', type: 'timestamp' });
}

/**
 * Enables soft deletion: `softDelete`/`softRemove` stamp this column, and
 * finds skip stamped rows unless `withDeleted` is set.
 */
export function DeleteDateColumn(options: DateColumnOptions = {}): PropertyDecorator {
  return (target, propertyKey) =>
    defineColumn(target, propertyKey, { ...options, nullable: true }, { mode: 'delete-date', type: 'timestamp' });
}

function defineRelation(
  kind: RelationKind,
  target: object,
  propertyKey: string | symbol,
  typeFn: () => Constructor,
  inverseSide: InverseSide | RelationOptions | undefined,
  options: RelationOptions | undefined
) {
  if (typeof propertyKey !== 'string') {
    throw new Error('[DrogonJS] Relations must be declared on string-named properties.');
  }
  const [inverse, relationOptions] =
    typeof inverseSide === 'object' ? [undefined, inverseSide] : [inverseSide, options ?? {}];
  rawMetadataOf(target.constructor).relations.set(propertyKey, {
    propertyName: propertyKey,
    kind,
    target: typeFn,
    inverseSide: inverse,
    options: relationOptions
  });
}

type RelationDecorator = <T>(
  typeFn: () => Constructor<T>,
  inverseSideOrOptions?: string | ((object: T) => unknown) | RelationOptions,
  options?: RelationOptions
) => PropertyDecorator;

/** Stores the target's key in a `<property>Id` column unless `@JoinColumn` names another. */
export const ManyToOne: RelationDecorator = (typeFn, inverseSide, options) => (target, propertyKey) =>
  defineRelation('many-to-one', target, propertyKey, typeFn, inverseSide as InverseSide, options);

/** The inverse of a `@ManyToOne` on the target; holds no column of its own. */
export const OneToMany: RelationDecorator = (typeFn, inverseSide, options) => (target, propertyKey) =>
  defineRelation('one-to-many', target, propertyKey, typeFn, inverseSide as InverseSide, options);

/** The side carrying `@JoinColumn` owns the foreign key. */
export const OneToOne: RelationDecorator = (typeFn, inverseSide, options) => (target, propertyKey) =>
  defineRelation('one-to-one', target, propertyKey, typeFn, inverseSide as InverseSide, options);

export function JoinColumn(options: JoinColumnOptions = {}): PropertyDecorator {
  return (target, propertyKey) => {
    rawMetadataOf(target.constructor).joinColumns.set(String(propertyKey), options);
  };
}

export interface IndexOptions {
  unique?: boolean;
}

/**
 * On a property, indexes that column. On a class, takes the property names to
 * index together: `@Index(['firstName', 'lastName'], { unique: true })`.
 */
export function Index(
  nameOrColumns?: string | string[] | IndexOptions,
  columnsOrOptions?: string[] | IndexOptions,
  maybeOptions?: IndexOptions
): ClassDecorator & PropertyDecorator {
  return ((target: object, propertyKey?: string | symbol) => {
    let name: string | undefined;
    let columns: string[] | undefined;
    let options: IndexOptions = {};
    if (typeof nameOrColumns === 'string') {
      name = nameOrColumns;
      if (Array.isArray(columnsOrOptions)) {
        columns = columnsOrOptions;
        options = maybeOptions ?? {};
      } else {
        options = columnsOrOptions ?? {};
      }
    } else if (Array.isArray(nameOrColumns)) {
      columns = nameOrColumns;
      options = (columnsOrOptions as IndexOptions | undefined) ?? {};
    } else {
      options = nameOrColumns ?? {};
    }

    const owner = propertyKey === undefined ? (target as Function) : target.constructor;
    if (propertyKey !== undefined) columns = [String(propertyKey)];
    if (!columns?.length) throw new Error('[DrogonJS] A class-level @Index needs the property names it covers.');
    rawMetadataOf(owner).indices.push({ columns, name, unique: options.unique ?? false });
  }) as ClassDecorator & PropertyDecorator;
}
