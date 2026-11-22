import type { Constructor } from '@drogonjs/common';
import type { DataSource } from './data-source';
import type { Dialect } from './metadata';
import {
  Repository,
  type Criteria,
  type DeepPartial,
  type DeleteResult,
  type FindManyOptions,
  type FindOneOptions,
  type FindOptionsWhere,
  type UpdateResult
} from './repository';

/**
 * Repositories bound to one drizzle executor: the data source's database, or
 * a transaction. Repositories obtained from a transaction's manager run
 * inside that transaction.
 */
export class EntityManager {
  private readonly repositories = new Map<Function, Repository<any>>();

  constructor(
    readonly dataSource: DataSource,
    /** The drizzle database or transaction every query here runs on. */
    readonly db: any,
    /** @internal nesting level, used to name savepoints */
    readonly depth = 0
  ) {}

  get dialect(): Dialect {
    return this.dataSource.dialect;
  }

  getRepository<T extends object>(target: Constructor<T>): Repository<T> {
    let repository = this.repositories.get(target);
    if (!repository) {
      repository = new Repository(target, this);
      this.repositories.set(target, repository);
    }
    return repository;
  }

  /** Runs `work` in a transaction (a savepoint when already inside one). */
  transaction<R>(work: (manager: EntityManager) => Promise<R>): Promise<R> {
    return this.dataSource.runTransaction(this, work);
  }

  find<T extends object>(target: Constructor<T>, options?: FindManyOptions<T>): Promise<T[]> {
    return this.getRepository(target).find(options);
  }

  findBy<T extends object>(target: Constructor<T>, where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<T[]> {
    return this.getRepository(target).findBy(where);
  }

  findOne<T extends object>(target: Constructor<T>, options: FindOneOptions<T>): Promise<T | null> {
    return this.getRepository(target).findOne(options);
  }

  findOneBy<T extends object>(target: Constructor<T>, where: FindOptionsWhere<T> | FindOptionsWhere<T>[]): Promise<T | null> {
    return this.getRepository(target).findOneBy(where);
  }

  count<T extends object>(target: Constructor<T>, options?: FindManyOptions<T>): Promise<number> {
    return this.getRepository(target).count(options);
  }

  /** `save(entity)` uses the entity's class; `save(Target, plain)` names it. */
  save<T extends object>(entity: T): Promise<T>;
  save<T extends object>(entities: T[]): Promise<T[]>;
  save<T extends object>(target: Constructor<T>, entity: DeepPartial<T>): Promise<T>;
  save<T extends object>(target: Constructor<T>, entities: DeepPartial<T>[]): Promise<T[]>;
  save(targetOrEntity: any, maybeEntity?: any): Promise<any> {
    if (typeof targetOrEntity === 'function') return this.getRepository(targetOrEntity).save(maybeEntity);
    const sample = Array.isArray(targetOrEntity) ? targetOrEntity[0] : targetOrEntity;
    if (!sample) return Promise.resolve(targetOrEntity);
    return this.getRepository(sample.constructor).save(targetOrEntity);
  }

  remove<T extends object>(entity: T): Promise<T>;
  remove<T extends object>(entities: T[]): Promise<T[]>;
  remove(entity: any): Promise<any> {
    const sample = Array.isArray(entity) ? entity[0] : entity;
    if (!sample) return Promise.resolve(entity);
    return this.getRepository(sample.constructor).remove(entity);
  }

  insert<T extends object>(target: Constructor<T>, values: DeepPartial<T> | DeepPartial<T>[]) {
    return this.getRepository(target).insert(values);
  }

  update<T extends object>(target: Constructor<T>, criteria: Criteria<T>, partial: DeepPartial<T>): Promise<UpdateResult> {
    return this.getRepository(target).update(criteria, partial);
  }

  delete<T extends object>(target: Constructor<T>, criteria: Criteria<T>): Promise<DeleteResult> {
    return this.getRepository(target).delete(criteria);
  }

  create<T extends object>(target: Constructor<T>, entityLike?: DeepPartial<T>): T {
    return this.getRepository(target).create(entityLike ?? {});
  }
}
