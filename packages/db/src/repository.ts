import {
  and,
  asc,
  between,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  or,
  sql,
  type SQL
} from 'drizzle-orm';
import type { Constructor } from '@drogonjs/common';
import { EntityNotFoundError } from './errors';
import { FindOperator, In } from './find-operators';
import { getEntityMetadata, type ColumnMetadata, type Dialect, type EntityMetadata, type RelationMetadata } from './metadata';
import { toTable } from './table-builder';
import type { EntityManager } from './entity-manager';

type Primitive = string | number | boolean | bigint | Date | null | undefined;

/** Equality, `null` for `IS NULL`, an operator, or the key of a related entity. */
export type FindOptionsWhereProperty<V> = V extends Primitive
  ? V | FindOperator<V> | null
  : V extends Array<unknown>
    ? never
    : V | FindOptionsWhere<V> | FindOperator<unknown> | Primitive;

export type FindOptionsWhere<T> = {
  [K in keyof T]?: FindOptionsWhereProperty<NonNullable<T[K]>>;
} & Record<string, unknown>;

export type SortDirection = 'ASC' | 'DESC' | 'asc' | 'desc' | 1 | -1;

export type FindOptionsOrder<T> = { [K in keyof T]?: SortDirection };

export type FindOptionsSelect<T> = Array<keyof T & string> | { [K in keyof T]?: boolean };

/** `['author', 'author.posts']` or `{ author: { posts: true } }`. */
export type FindOptionsRelations<T> = string[] | { [K in keyof T]?: boolean | Record<string, unknown> };

export interface FindManyOptions<T> {
  where?: FindOptionsWhere<T> | FindOptionsWhere<T>[];
  select?: FindOptionsSelect<T>;
  order?: FindOptionsOrder<T>;
  skip?: number;
  take?: number;
  relations?: FindOptionsRelations<T>;
  /** Include soft-deleted rows. */
  withDeleted?: boolean;
}

export type FindOneOptions<T> = Omit<FindManyOptions<T>, 'skip' | 'take'>;

/** A primary key value, several of them, or a `where` object. */
export type Criteria<T> = string | number | Date | Array<string | number> | FindOptionsWhere<T>;

export interface UpdateResult {
  affected: number;
}

export type DeleteResult = UpdateResult;

export interface InsertResult<T> {
  /** Primary key values of the inserted rows. */
  identifiers: Array<Partial<T>>;
  /** The inserted entities, including generated values. */
  generatedMaps: T[];
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U> ? Array<DeepPartial<U>> : T[K] extends Date ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

type RelationTree = Map<string, RelationTree>;

/** Keeps `IN (...)` lists under every driver's bound-parameter limit. */
const IN_CHUNK = 500;

/**
 * TypeORM-style data access for one entity, running on drizzle. Every method
 * builds on `table` and `db`, which stay available for anything this API does
 * not cover.
 */
export class Repository<T extends object> {
  readonly metadata: EntityMetadata;
  /** The drizzle table, keyed by property name. */
  readonly table: any;

  constructor(
    readonly target: Constructor<T>,
    readonly manager: EntityManager
  ) {
    this.metadata = getEntityMetadata(target);
    this.table = toTable(target, manager.dialect);
  }

  /** The drizzle database, or the transaction this repository was obtained from. */
  get db(): any {
    return this.manager.db;
  }

  get dialect(): Dialect {
    return this.manager.dialect;
  }

  // ---------------------------------------------------------------- creating

  /** A new entity instance; nothing is written until `save`. */
  create(): T;
  create(entityLike: DeepPartial<T>): T;
  create(entityLikes: DeepPartial<T>[]): T[];
  create(entityLike?: DeepPartial<T> | DeepPartial<T>[]): T | T[] {
    if (Array.isArray(entityLike)) return entityLike.map(item => this.create(item));
    let instance: T;
    try {
      instance = new this.target();
    } catch {
      instance = Object.create(this.target.prototype);
    }
    return Object.assign(instance, entityLike ?? {});
  }

  merge(entity: T, ...entityLikes: DeepPartial<T>[]): T {
    return Object.assign(entity, ...entityLikes);
  }

  hasId(entity: T): boolean {
    return this.metadata.primaryColumns.every(column => (entity as any)[column.propertyName] != null);
  }

  getId(entity: T): unknown {
    const ids = this.metadata.primaryColumns.map(column => (entity as any)[column.propertyName]);
    if (ids.length === 1) return ids[0];
    return Object.fromEntries(this.metadata.primaryColumns.map((column, index) => [column.propertyName, ids[index]]));
  }

  // ----------------------------------------------------------------- reading

  async find(options: FindManyOptions<T> = {}): Promise<T[]> {
    const relations = relationTree(options.relations);
    let query = this.db.select(this.selection(options.select, relations)).from(this.table).$dynamic();

    const condition = this.condition(options.where, options.withDeleted);
    if (condition) query = query.where(condition);
    const order = this.ordering(options.order);
    if (order.length) query = query.orderBy(...order);
    if (options.take !== undefined) query = query.limit(options.take);
    if (options.skip !== undefined) {
      // SQLite and MySQL only accept OFFSET after a LIMIT. drizzle drops a
      // negative one, so "no limit" is spelled as the largest safe integer.
      if (options.take === undefined && this.dialect !== 'postgres') query = query.limit(Number.MAX_SAFE_INTEGER);
      query = query.offset(options.skip);
    }

    const entities = ((await query) as Record<string, unknown>[]).map(row => this.hydrate(row));
    if (relations.size) await this.loadRelations(entities, relations, options.withDeleted);
    return entities;
  }

  findBy(where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<T[]> {
    return this.find({ where });
  }

  async findOne(options: FindOneOptions<T>): Promise<T | null> {
    const [entity] = await this.find({ ...options, take: 1 });
    return entity ?? null;
  }

  findOneBy(where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<T | null> {
    return this.findOne({ where });
  }

  async findOneOrFail(options: FindOneOptions<T>): Promise<T> {
    const entity = await this.findOne(options);
    if (!entity) throw new EntityNotFoundError(this.target, options.where ?? {});
    return entity;
  }

  async findOneByOrFail(where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<T> {
    const entity = await this.findOneBy(where);
    if (!entity) throw new EntityNotFoundError(this.target, where);
    return entity;
  }

  /** The requested page and the total count ignoring `skip`/`take`. */
  async findAndCount(options: FindManyOptions<T> = {}): Promise<[T[], number]> {
    const [entities, total] = await Promise.all([this.find(options), this.count(options)]);
    return [entities, total];
  }

  findAndCountBy(where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<[T[], number]> {
    return this.findAndCount({ where });
  }

  async count(options: Pick<FindManyOptions<T>, 'where' | 'withDeleted'> = {}): Promise<number> {
    let query = this.db.select({ value: count() }).from(this.table).$dynamic();
    const condition = this.condition(options.where, options.withDeleted);
    if (condition) query = query.where(condition);
    const [row] = await query;
    return Number(row?.value ?? 0);
  }

  countBy(where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<number> {
    return this.count({ where });
  }

  async exists(options: Pick<FindManyOptions<T>, 'where' | 'withDeleted'> = {}): Promise<boolean> {
    let query = this.db.select({ value: sql`1` }).from(this.table).$dynamic();
    const condition = this.condition(options.where, options.withDeleted);
    if (condition) query = query.where(condition);
    const rows = await query.limit(1);
    return rows.length > 0;
  }

  existsBy(where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<boolean> {
    return this.exists({ where });
  }

  // ----------------------------------------------------------------- writing

  /**
   * Inserts entities without a primary key or whose key is not in the table,
   * updates the rest, and copies generated values back onto each entity.
   */
  save<E extends DeepPartial<T>>(entities: E[]): Promise<Array<E & T>>;
  save<E extends DeepPartial<T>>(entity: E): Promise<E & T>;
  async save(input: any): Promise<any> {
    if (Array.isArray(input)) {
      const saved = [];
      // Sequential, so the order of generated keys matches the input order.
      for (const entity of input) saved.push(await this.saveOne(entity));
      return saved;
    }
    return this.saveOne(input);
  }

  async insert(input: DeepPartial<T> | DeepPartial<T>[]): Promise<InsertResult<T>> {
    const items = Array.isArray(input) ? input : [input];
    const generatedMaps: T[] = [];
    for (const item of items) {
      generatedMaps.push(await this.insertRow(this.toRow(item, 'insert')));
    }
    return {
      identifiers: generatedMaps.map(entity => this.primaryOf(entity) as Partial<T>),
      generatedMaps
    };
  }

  /** Updates every row matching `criteria`; an empty criteria is refused. */
  async update(criteria: Criteria<T>, partial: DeepPartial<T>): Promise<UpdateResult> {
    const values = this.toRow(partial, 'update');
    return this.updateWhere(this.criteriaCondition(criteria, 'update'), values);
  }

  /** Inserts, or updates the row that conflicts on `conflictPaths` (property names). */
  async upsert(input: DeepPartial<T> | DeepPartial<T>[], conflictPaths: string[] | { conflictPaths: string[] }): Promise<InsertResult<T>> {
    const paths = Array.isArray(conflictPaths) ? conflictPaths : conflictPaths.conflictPaths;
    const items = Array.isArray(input) ? input : [input];
    const generatedMaps: T[] = [];

    for (const item of items) {
      const row = this.toRow(item, 'insert');
      const updatable = Object.keys(row).filter(key => !paths.includes(key));
      let query: any = this.db.insert(this.table).values(row);
      if (this.dialect === 'mysql') {
        const set = Object.fromEntries(
          (updatable.length ? updatable : paths).map(key => [key, sql.raw(`values(\`${this.column(key).databaseName}\`)`)])
        );
        await query.onDuplicateKeyUpdate({ set });
        const keyWhere = Object.fromEntries(paths.map(key => [key, (row as any)[key]]));
        generatedMaps.push((await this.findOne({ where: keyWhere as FindOptionsWhere<T>, withDeleted: true }))!);
        continue;
      }
      const target = paths.map(key => this.table[key]);
      query = updatable.length
        ? query.onConflictDoUpdate({
            target,
            set: Object.fromEntries(updatable.map(key => [key, sql.raw(`excluded."${this.column(key).databaseName}"`)]))
          })
        : query.onConflictDoNothing({ target });
      const [saved] = await query.returning();
      generatedMaps.push(saved ? this.hydrate(saved) : (await this.findOne({
        where: Object.fromEntries(paths.map(key => [key, (row as any)[key]])) as FindOptionsWhere<T>,
        withDeleted: true
      }))!);
    }

    return {
      identifiers: generatedMaps.map(entity => this.primaryOf(entity) as Partial<T>),
      generatedMaps
    };
  }

  async delete(criteria: Criteria<T>): Promise<DeleteResult> {
    const condition = this.criteriaCondition(criteria, 'delete', true);
    return { affected: await this.affected(this.db.delete(this.table).where(condition)) };
  }

  /** Deletes the given entities by primary key and clears the key on each. */
  remove<E extends T>(entities: E[]): Promise<E[]>;
  remove<E extends T>(entity: E): Promise<E>;
  async remove(input: any): Promise<any> {
    const items: T[] = Array.isArray(input) ? input : [input];
    for (const entity of items) {
      await this.db.delete(this.table).where(this.primaryCondition(entity));
      for (const column of this.metadata.primaryColumns) (entity as any)[column.propertyName] = undefined;
    }
    return input;
  }

  /** Stamps the delete-date column of every row matching `criteria`. */
  async softDelete(criteria: Criteria<T>): Promise<UpdateResult> {
    const column = this.requireDeleteDate('softDelete');
    return this.updateWhere(this.criteriaCondition(criteria, 'softDelete'), { [column.propertyName]: new Date() });
  }

  /** Clears the delete-date column of every row matching `criteria`. */
  async restore(criteria: Criteria<T>): Promise<UpdateResult> {
    const column = this.requireDeleteDate('restore');
    return this.updateWhere(this.criteriaCondition(criteria, 'restore', true), { [column.propertyName]: null });
  }

  softRemove<E extends T>(entities: E[]): Promise<E[]>;
  softRemove<E extends T>(entity: E): Promise<E>;
  async softRemove(input: any): Promise<any> {
    const column = this.requireDeleteDate('softRemove');
    for (const entity of Array.isArray(input) ? input : [input]) {
      const stamp = new Date();
      await this.updateWhere(this.primaryCondition(entity), { [column.propertyName]: stamp });
      entity[column.propertyName] = stamp;
    }
    return input;
  }

  recover<E extends T>(entities: E[]): Promise<E[]>;
  recover<E extends T>(entity: E): Promise<E>;
  async recover(input: any): Promise<any> {
    const column = this.requireDeleteDate('recover');
    for (const entity of Array.isArray(input) ? input : [input]) {
      await this.updateWhere(this.primaryCondition(entity), { [column.propertyName]: null });
      entity[column.propertyName] = null;
    }
    return input;
  }

  increment(where: FindOptionsWhere<T>, propertyPath: keyof T & string, value: number): Promise<UpdateResult> {
    const column = this.table[this.column(propertyPath).propertyName];
    return this.updateWhere(this.criteriaCondition(where, 'increment'), { [propertyPath]: sql`${column} + ${value}` });
  }

  decrement(where: FindOptionsWhere<T>, propertyPath: keyof T & string, value: number): Promise<UpdateResult> {
    return this.increment(where, propertyPath, -value);
  }

  /** Deletes every row in the table. */
  async clear(): Promise<void> {
    await this.db.delete(this.table);
  }

  // ---------------------------------------------------------------- internal

  private async saveOne(entity: any): Promise<any> {
    if (this.hasId(entity) && (await this.exists({ where: this.primaryOf(entity) as FindOptionsWhere<T>, withDeleted: true }))) {
      const values = this.toRow(entity, 'update');
      for (const column of this.metadata.primaryColumns) delete values[column.propertyName];
      if (Object.keys(values).length || this.metadata.updateDateColumn) {
        const condition = this.primaryCondition(entity);
        if (this.dialect === 'mysql') {
          await this.db.update(this.table).set(values).where(condition);
        } else {
          const [row] = await this.db.update(this.table).set(values).where(condition).returning();
          return Object.assign(entity, row);
        }
      }
      const reloaded = await this.db.select().from(this.table).where(this.primaryCondition(entity)).limit(1);
      return Object.assign(entity, reloaded[0]);
    }

    const saved = await this.insertRow(this.toRow(entity, 'insert'));
    return Object.assign(entity, saved);
  }

  private async insertRow(row: Record<string, unknown>): Promise<T> {
    if (this.dialect !== 'mysql') {
      const [saved] = await this.db.insert(this.table).values(row).returning();
      return this.hydrate(saved);
    }
    // MySQL has no RETURNING: read the generated key back, then the row.
    const [ids] = await this.db.insert(this.table).values(row).$returningId();
    const key = { ...this.primaryOf(row), ...(ids ?? {}) };
    const [saved] = await this.db.select().from(this.table).where(this.primaryCondition(key)).limit(1);
    return this.hydrate(saved);
  }

  private async updateWhere(condition: SQL | undefined, values: Record<string, unknown>): Promise<UpdateResult> {
    let query = this.db.update(this.table).set(values);
    if (condition) query = query.where(condition);
    return { affected: await this.affected(query) };
  }

  /** Rows touched by an update or delete, read the way each driver reports it. */
  private async affected(query: any): Promise<number> {
    if (this.dialect === 'mysql') {
      const result = await query;
      return Number((Array.isArray(result) ? result[0] : result)?.affectedRows ?? 0);
    }
    const primary = this.metadata.primaryColumns[0]!;
    const rows = await query.returning({ key: this.table[primary.propertyName] });
    return rows.length;
  }

  private requireDeleteDate(method: string): ColumnMetadata {
    const column = this.metadata.deleteDateColumn;
    if (!column) throw new Error(`[DrogonJS] ${method}() needs a @DeleteDateColumn on ${this.metadata.name}.`);
    return column;
  }

  private column(propertyName: string): ColumnMetadata {
    const column = this.metadata.findColumn(propertyName);
    if (!column) throw new Error(`[DrogonJS] ${this.metadata.name} has no column "${propertyName}".`);
    return column;
  }

  /** Row data for a write: known columns only, relation objects turned into keys. */
  private toRow(entity: any, mode: 'insert' | 'update'): Record<string, any> {
    const row: Record<string, any> = {};
    for (const relation of this.metadata.relations) {
      if (!relation.owner || !(relation.propertyName in entity)) continue;
      const related = entity[relation.propertyName];
      if (related === undefined) continue;
      row[relation.joinColumn!.propertyName] = related === null ? null : related[relation.referencedColumn!.propertyName];
    }
    for (const column of this.metadata.columns) {
      const value = entity[column.propertyName];
      if (value === undefined || column.propertyName in row) continue;
      // The update date is refreshed by the table's $onUpdate, and a row's
      // creation date never changes.
      if (mode === 'update' && (column.mode === 'update-date' || column.mode === 'create-date')) continue;
      row[column.propertyName] = value;
    }
    return row;
  }

  private hydrate(row: Record<string, unknown>): T {
    return Object.assign(Object.create(this.target.prototype), row);
  }

  private primaryOf(entity: any): Record<string, unknown> {
    return Object.fromEntries(this.metadata.primaryColumns.map(column => [column.propertyName, entity[column.propertyName]]));
  }

  private primaryCondition(entity: any): SQL {
    if (!this.hasId(entity)) throw new Error(`[DrogonJS] ${this.metadata.name} entity has no primary key value.`);
    return and(...this.metadata.primaryColumns.map(column => eq(this.table[column.propertyName], entity[column.propertyName])))!;
  }

  private criteriaCondition(criteria: Criteria<T>, method: string, withDeleted = false): SQL | undefined {
    const isEmpty =
      criteria === undefined ||
      criteria === null ||
      (Array.isArray(criteria) && criteria.length === 0) ||
      (typeof criteria === 'object' && !Array.isArray(criteria) && !(criteria instanceof Date) && Object.keys(criteria).length === 0);
    if (isEmpty) {
      throw new Error(`[DrogonJS] ${this.metadata.name}.${method}() needs criteria. Use clear() to affect every row.`);
    }
    if (typeof criteria !== 'object' || criteria instanceof Date || Array.isArray(criteria)) {
      const [primary, ...rest] = this.metadata.primaryColumns;
      if (!primary || rest.length) {
        throw new Error(`[DrogonJS] ${this.metadata.name}.${method}() by id needs exactly one primary column; pass a where object.`);
      }
      const where = { [primary.propertyName]: Array.isArray(criteria) ? In(criteria) : criteria };
      return this.condition(where as FindOptionsWhere<T>, withDeleted);
    }
    return this.condition(criteria as FindOptionsWhere<T>, withDeleted);
  }

  private condition(where: FindManyOptions<T>['where'], withDeleted = false): SQL | undefined {
    const branches = (Array.isArray(where) ? where : where ? [where] : []).map(branch => this.branchCondition(branch));
    // A branch without conditions matches everything, which makes the whole OR do so.
    let combined = branches.length && branches.every(Boolean)
      ? branches.length === 1 ? branches[0] : or(...branches)
      : undefined;

    const deleteDate = this.metadata.deleteDateColumn;
    if (deleteDate && !withDeleted) {
      const live = isNull(this.table[deleteDate.propertyName]);
      combined = combined ? and(combined, live) : live;
    }
    return combined;
  }

  private branchCondition(branch: Record<string, unknown>): SQL | undefined {
    const conditions: SQL[] = [];
    for (const [key, value] of Object.entries(branch)) {
      // Undefined is skipped, matching TypeORM, so optional filters can be passed through.
      if (value === undefined) continue;
      const column = this.metadata.findColumn(key);
      if (column) {
        conditions.push(this.compare(this.table[key], value));
        continue;
      }
      const relation = this.metadata.findRelation(key);
      if (relation) {
        conditions.push(this.relationCondition(relation, value));
        continue;
      }
      throw new Error(`[DrogonJS] ${this.metadata.name} has no column or relation "${key}" to filter on.`);
    }
    if (!conditions.length) return undefined;
    return conditions.length === 1 ? conditions[0] : and(...conditions);
  }

  /** `{ author: { id: 1 } }`, `{ author: 1 }` or `{ author: In([1, 2]) }` filter on the join column. */
  private relationCondition(relation: RelationMetadata, value: unknown): SQL {
    if (!relation.owner) {
      throw new Error(
        `[DrogonJS] Filtering ${this.metadata.name} by the inverse relation "${relation.propertyName}" is not ` +
        'supported. Query the owning side, or use repository.db with a join.'
      );
    }
    const joinColumn = this.table[relation.joinColumn!.propertyName];
    const referenced = relation.referencedColumn!.propertyName;
    if (value === null || value instanceof FindOperator || typeof value !== 'object' || value instanceof Date) {
      return this.compare(joinColumn, value);
    }
    const keys = Object.keys(value as object).filter(key => (value as any)[key] !== undefined);
    const extra = keys.filter(key => key !== referenced);
    // An entity instance carries other fields too; only a plain filter object is held to the key alone.
    if (extra.length && Object.getPrototypeOf(value) === Object.prototype) {
      throw new Error(
        `[DrogonJS] ${this.metadata.name}.${relation.propertyName} can only be filtered by "${referenced}"; ` +
        `got ${extra.join(', ')}. Use repository.db with a join for nested filters.`
      );
    }
    return this.compare(joinColumn, (value as any)[referenced]);
  }

  private compare(column: any, value: unknown): SQL {
    if (value === null) return isNull(column);
    if (!(value instanceof FindOperator)) return eq(column, value);
    const operand = value.value as any;
    switch (value.type) {
      case 'equal':
        return operand === null ? isNull(column) : eq(column, operand);
      case 'in':
        return inArray(column, operand);
      case 'not':
        if (operand instanceof FindOperator) return not(this.compare(column, operand));
        return operand === null ? isNotNull(column) : ne(column, operand);
      case 'like':
        return like(column, operand);
      case 'ilike':
        return this.dialect === 'postgres' ? ilike(column, operand) : sql`lower(${column}) like lower(${operand})`;
      case 'moreThan':
        return gt(column, operand);
      case 'moreThanOrEqual':
        return gte(column, operand);
      case 'lessThan':
        return lt(column, operand);
      case 'lessThanOrEqual':
        return lte(column, operand);
      case 'between':
        return between(column, operand[0], operand[1]);
      case 'isNull':
        return isNull(column);
      case 'raw':
        return operand(column);
    }
  }

  private ordering(order: FindOptionsOrder<T> | undefined): SQL[] {
    if (!order) return [];
    return Object.entries(order).map(([key, direction]) => {
      const column = this.table[this.column(key).propertyName];
      return direction === 'DESC' || direction === 'desc' || direction === -1 ? desc(column) : asc(column);
    });
  }

  /**
   * Columns to read. Primary keys, and the join columns of relations being
   * loaded, are always included so relations can be attached.
   */
  private selection(select: FindOptionsSelect<T> | undefined, relations: RelationTree): Record<string, any> | undefined {
    if (!select) return undefined;
    const names = Array.isArray(select)
      ? select
      : Object.entries(select).filter(([, enabled]) => enabled).map(([name]) => name);
    const keys = new Set<string>(this.metadata.primaryColumns.map(column => column.propertyName));
    for (const name of names) keys.add(this.column(name).propertyName);
    for (const name of relations.keys()) {
      const relation = this.metadata.findRelation(name);
      if (relation?.owner) keys.add(relation.joinColumn!.propertyName);
    }
    return Object.fromEntries([...keys].map(key => [key, this.table[key]]));
  }

  /** Attaches relations with one batched query per relation and level. */
  private async loadRelations(entities: T[], tree: RelationTree, withDeleted?: boolean) {
    for (const [name, nested] of tree) {
      const relation = this.metadata.findRelation(name);
      if (!relation) throw new Error(`[DrogonJS] ${this.metadata.name} has no relation "${name}".`);
      const related = this.manager.getRepository(relation.target as Constructor<any>);
      const relations = treeToObject(nested);

      if (relation.owner) {
        const fk = relation.joinColumn!.propertyName;
        const ref = relation.referencedColumn!.propertyName;
        const found = await related.findIn(ref, unique(entities.map(entity => (entity as any)[fk])), relations, withDeleted);
        const byKey = new Map(found.map(item => [keyOf(item[ref]), item]));
        for (const entity of entities) {
          const key = (entity as any)[fk];
          (entity as any)[name] = key == null ? null : byKey.get(keyOf(key)) ?? null;
        }
        continue;
      }

      const inverse = related.metadata.relations.find(
        candidate =>
          candidate.owner &&
          candidate.target === this.target &&
          (relation.inversePropertyName === undefined || candidate.propertyName === relation.inversePropertyName)
      );
      if (!inverse) {
        throw new Error(
          `[DrogonJS] ${this.metadata.name}.${name} needs a @ManyToOne/@OneToOne with @JoinColumn on ` +
          `${related.metadata.name} pointing back at ${this.metadata.name}.`
        );
      }
      const fk = inverse.joinColumn!.propertyName;
      const ref = inverse.referencedColumn!.propertyName;
      const found = await related.findIn(fk, unique(entities.map(entity => (entity as any)[ref])), relations, withDeleted);
      const groups = new Map<unknown, any[]>();
      for (const item of found) {
        const key = keyOf(item[fk]);
        groups.set(key, [...(groups.get(key) ?? []), item]);
      }
      for (const entity of entities) {
        const group = groups.get(keyOf((entity as any)[ref])) ?? [];
        (entity as any)[name] = relation.kind === 'one-to-many' ? group : group[0] ?? null;
      }
    }
  }

  /** @internal rows whose `property` is any of `values`, fetched in chunks */
  async findIn(property: string, values: unknown[], relations: FindOptionsRelations<any> | undefined, withDeleted?: boolean): Promise<any[]> {
    const present = values.filter(value => value != null);
    const results: any[] = [];
    for (let start = 0; start < present.length; start += IN_CHUNK) {
      const chunk = present.slice(start, start + IN_CHUNK);
      results.push(...(await this.find({ where: { [property]: In(chunk) } as any, relations, withDeleted })));
    }
    return results;
  }
}

function unique(values: unknown[]): unknown[] {
  const seen = new Map<unknown, unknown>();
  for (const value of values) if (value != null) seen.set(keyOf(value), value);
  return [...seen.values()];
}

/** Map key for a column value: dates and bigints compare by value, not identity. */
function keyOf(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'bigint') return value.toString();
  return value;
}

function relationTree(relations: FindOptionsRelations<any> | undefined): RelationTree {
  const tree: RelationTree = new Map();
  if (!relations) return tree;
  if (Array.isArray(relations)) {
    for (const path of relations) {
      let node = tree;
      for (const part of path.split('.')) {
        if (!node.has(part)) node.set(part, new Map());
        node = node.get(part)!;
      }
    }
    return tree;
  }
  for (const [name, value] of Object.entries(relations)) {
    if (!value) continue;
    tree.set(name, typeof value === 'object' ? relationTree(value as any) : new Map());
  }
  return tree;
}

function treeToObject(tree: RelationTree): any {
  if (!tree.size) return undefined;
  return Object.fromEntries([...tree].map(([name, nested]) => [name, treeToObject(nested) ?? true]));
}
