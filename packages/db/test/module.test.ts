import { describe, expect, test } from 'bun:test';
import { Inject, Injectable, Module } from '@drogonjs/common';
import { ApplicationContext } from '@drogonjs/core';
import {
  Column,
  DataSource,
  DrizzleModule,
  Entity,
  EntityManager,
  InjectDataSource,
  InjectEntityManager,
  InjectRepository,
  PrimaryGeneratedColumn,
  Repository,
  getDataSourceToken,
  getRepositoryToken,
  type DrizzleOptionsFactory
} from '../src';

@Entity()
class Note {
  @PrimaryGeneratedColumn() id!: number;
  @Column() text!: string;
}

@Entity()
class AuditEntry {
  @PrimaryGeneratedColumn() id!: number;
  @Column() action!: string;
}

@Injectable()
class NotesService {
  constructor(
    @InjectRepository(Note) readonly notes: Repository<Note>,
    readonly dataSource: DataSource,
    @InjectEntityManager() readonly manager: EntityManager
  ) {}

  add(text: string) {
    return this.notes.save(this.notes.create({ text }));
  }
}

@Module({
  imports: [DrizzleModule.forFeature([Note])],
  providers: [NotesService],
  exports: [NotesService]
})
class NotesModule {}

describe('DrizzleModule', () => {
  test('forRoot + forFeature inject repositories, the data source and its manager', async () => {
    @Module({
      imports: [DrizzleModule.forRoot({ dialect: 'sqlite', url: ':memory:', entities: [Note], synchronize: true }), NotesModule]
    })
    class AppModule {}

    const app = await ApplicationContext.create(AppModule);
    const service = await app.get(NotesService);
    await service.add('hello');
    expect(await service.notes.count()).toBe(1);
    expect(service.notes).toBeInstanceOf(Repository);
    expect(service.dataSource.isInitialized).toBe(true);
    expect(service.manager).toBe(service.dataSource.manager);
    expect(await app.get<Repository<Note>>(getRepositoryToken(Note))).toBe(service.notes);

    // The data source closes with the application.
    await app.close();
    expect(service.dataSource.isInitialized).toBe(false);
  });

  test('autoLoadEntities synchronizes the entities registered with forFeature', async () => {
    @Module({
      imports: [DrizzleModule.forRoot({ dialect: 'sqlite', url: ':memory:', autoLoadEntities: true, synchronize: true }), NotesModule]
    })
    class AppModule {}

    const app = await ApplicationContext.create(AppModule);
    const service = await app.get(NotesService);
    expect((await service.add('auto')).id).toBe(1);
    await app.close();
  });

  test('forRootAsync with useFactory and injected configuration', async () => {
    const CONFIG = Symbol('CONFIG');

    @Module({ providers: [{ provide: CONFIG, useValue: { url: ':memory:' } }], exports: [CONFIG] })
    class ConfigModule {}

    @Module({
      imports: [
        DrizzleModule.forRootAsync({
          imports: [ConfigModule],
          inject: [CONFIG],
          useFactory: (config: { url: string }) => ({ dialect: 'sqlite', url: config.url, entities: [Note], synchronize: true })
        }),
        NotesModule
      ]
    })
    class AppModule {}

    const app = await ApplicationContext.create(AppModule);
    const service = await app.get(NotesService);
    await service.add('async');
    expect((await service.notes.findOneByOrFail({ text: 'async' })).id).toBe(1);
    await app.close();
  });

  test('forRootAsync with useClass', async () => {
    @Injectable()
    class DrizzleConfig implements DrizzleOptionsFactory {
      createDrizzleOptions() {
        return { dialect: 'sqlite' as const, url: ':memory:', entities: [Note], synchronize: true };
      }
    }

    @Module({ imports: [DrizzleModule.forRootAsync({ useClass: DrizzleConfig }), NotesModule] })
    class AppModule {}

    const app = await ApplicationContext.create(AppModule);
    expect(await (await app.get(NotesService)).notes.count()).toBe(0);
    await app.close();
  });

  test('named data sources stay separate', async () => {
    @Injectable()
    class AuditService {
      constructor(
        @InjectRepository(AuditEntry, 'audit') readonly entries: Repository<AuditEntry>,
        @InjectDataSource('audit') readonly dataSource: DataSource,
        @Inject(DataSource) readonly main: DataSource
      ) {}
    }

    @Module({
      imports: [
        DrizzleModule.forRoot({ dialect: 'sqlite', url: ':memory:', entities: [Note], synchronize: true }),
        DrizzleModule.forRoot({ name: 'audit', dialect: 'sqlite', url: ':memory:', entities: [AuditEntry], synchronize: true }),
        DrizzleModule.forFeature([AuditEntry], 'audit'),
        NotesModule
      ],
      providers: [AuditService]
    })
    class AppModule {}

    const app = await ApplicationContext.create(AppModule);
    const audit = await app.get(AuditService);
    expect(audit.dataSource).not.toBe(audit.main);
    expect(await app.get(getDataSourceToken('audit'))).toBe(audit.dataSource);
    expect(getRepositoryToken(AuditEntry, 'audit')).not.toBe(getRepositoryToken(AuditEntry));

    await audit.entries.save({ action: 'login' });
    expect(await audit.entries.count()).toBe(1);
    // The audit table only exists in the audit database.
    await expect(audit.main.query('SELECT * FROM audit_entry')).rejects.toThrow();
    await app.close();
  });

  test('a data source passed in as `db` is not closed by the module', async () => {
    const { Database } = await import('bun:sqlite');
    const { drizzle } = await import('drizzle-orm/bun-sqlite');
    const client = new Database(':memory:');

    @Module({
      imports: [DrizzleModule.forRoot({ dialect: 'sqlite', db: drizzle(client), entities: [Note], synchronize: true }), NotesModule]
    })
    class AppModule {}

    const app = await ApplicationContext.create(AppModule);
    await (await app.get(NotesService)).add('kept');
    await app.close();
    expect(client.query('SELECT count(*) AS n FROM note').get()).toEqual({ n: 1 });
  });
});
