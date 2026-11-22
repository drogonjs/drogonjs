# @drogonjs/db

TypeORM-style entities, repositories and module for DrogonJS, running on
[Drizzle ORM](https://orm.drizzle.team). Postgres, MySQL and SQLite.

```bash
bun add @drogonjs/db drizzle-orm
bun add mysql2            # MySQL only; Postgres and SQLite use Bun's built-in drivers
```

## Entities

```ts
import {
  Column, CreateDateColumn, DeleteDateColumn, Entity, JoinColumn, ManyToOne,
  OneToMany, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn
} from '@drogonjs/db';

@Entity('users')                     // table name; defaults to snake_case class name
export class User {
  @PrimaryGeneratedColumn()          // or ('uuid')
  id!: number;

  @Column()                          // type inferred: string → varchar(255)
  name!: string;

  @Column({ unique: true, length: 120 })
  email!: string;

  @Column({ nullable: true })        // number → integer
  age!: number | null;

  @Column({ type: 'enum', enum: Role, default: Role.Member })
  role!: Role;

  @Column({ type: 'json', nullable: true })
  settings!: { theme: string } | null;

  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;

  @OneToMany(() => Post, post => post.author)
  posts!: Post[];
}

@Entity()
export class Post {
  @PrimaryGeneratedColumn() id!: number;
  @Column() title!: string;

  // Adds an `authorId` column (override with @JoinColumn({ name })).
  @ManyToOne(() => User, user => user.posts, { onDelete: 'CASCADE' })
  author!: User;

  @DeleteDateColumn()                // enables soft delete
  deletedAt!: Date | null;
}
```

Also available: `@PrimaryColumn` (several make a composite key), `@OneToOne` +
`@JoinColumn`, and `@Index()` on a property or `@Index(['a', 'b'], { unique: true })`
on a class. Base classes may declare shared columns.

Column types: `varchar char text uuid integer int smallint bigint real float
double decimal numeric boolean timestamp timestamptz datetime date time json
jsonb enum blob`. A literal `default` becomes the DDL default, a function runs
in the application on insert, and a drizzle `sql` fragment is used verbatim.

## Module

```ts
import { DrizzleModule } from '@drogonjs/db';

@Module({
  imports: [
    DrizzleModule.forRoot({
      dialect: 'postgres',           // 'postgres' | 'mysql' | 'sqlite'
      url: process.env.DATABASE_URL,
      entities: [User, Post],        // or autoLoadEntities: true
      synchronize: true,             // dev/test only: creates missing tables
    }),
    UsersModule,
  ],
})
export class AppModule {}

@Module({
  imports: [DrizzleModule.forFeature([User])],
  providers: [UsersService],
})
export class UsersModule {}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly dataSource: DataSource,
  ) {}
}
```

`url` drivers: Bun SQL for Postgres, `bun:sqlite` for SQLite (a path or
`:memory:`), a mysql2 pool for MySQL. To use any other drizzle driver, pass the
database yourself with `db` (it will not be closed for you):

```ts
DrizzleModule.forRoot({ dialect: 'postgres', db: drizzle(new PGlite()), entities: [User] })
```

`forRootAsync({ imports, inject, useFactory })`, `useClass` and `useExisting`
(a `DrizzleOptionsFactory`) work like `TypeOrmModule.forRootAsync`. Pass
`name` to `forRoot`, `forFeature`, `@InjectRepository(Entity, name)` and
`@InjectDataSource(name)` for several databases. The connection closes when the
application does.

## Repository

```ts
await users.save(users.create({ name: 'Ada', email: 'ada@x.io' })); // insert, or update by primary key
await users.find({
  where: { age: MoreThan(18), name: ILike('a%') },   // array of objects = OR
  relations: ['posts'],                               // or { posts: { author: true } }
  order: { createdAt: 'DESC' },
  skip: 20,
  take: 10,
});
await users.findOneBy({ id: 1 });
await users.findOneByOrFail({ id: 1 });              // EntityNotFoundError → 404
await users.findAndCount({ take: 10 });
await users.update({ role: Role.Member }, { active: false });
await users.delete(1);                                // id, ids or a where object
await posts.softDelete(1); await posts.restore(1);    // finds skip deleted rows unless withDeleted
await users.increment({ id: 1 }, 'age', 1);
await users.upsert({ email: 'ada@x.io', name: 'Ada' }, ['email']);
```

Also `findBy`, `findOne`, `findOneOrFail`, `findAndCountBy`, `count`, `countBy`,
`exists`, `existsBy`, `insert`, `remove`, `softRemove`, `recover`, `decrement`,
`clear`, `merge`, `hasId`, `getId`. Operators: `In Not Like ILike MoreThan
MoreThanOrEqual LessThan LessThanOrEqual Between IsNull Equal Raw`.

Filter on a relation with its key: `{ author: { id: 1 } }`, `{ author: user }`
or `{ author: In([1, 2]) }`. Relations load with one batched query per
relation and level.

For anything else, drop to drizzle: `repository.table` is the drizzle table
(keyed by property name) and `repository.db` the database or transaction.

```ts
await users.db.select().from(users.table).where(gt(users.table.age, 18));
```

## Transactions

```ts
await dataSource.transaction(async manager => {
  const user = await manager.save(User, { name: 'Ada', email: 'ada@x.io' });
  await manager.getRepository(Post).save({ title: 'Hi', author: user });
});
```

A nested `manager.transaction()` uses a savepoint. On SQLite, transactions
are issued as `BEGIN`/`COMMIT` on the shared connection, so other queries made
while one is open take part in it.

## Migrations

`synchronize` only creates missing tables. For real migrations, export the
generated drizzle tables and point drizzle-kit at that file:

```ts
// src/db/schema.ts
import { toTable } from '@drogonjs/db';
export const users = toTable(User, 'postgres');
export const posts = toTable(Post, 'postgres');
```

## Not supported yet

- `@ManyToMany` and join tables
- Cascading saves of related entities (save the related entity first)
- Filtering or ordering by fields of a related entity (use `repository.db` with a join)
- Altering existing tables in `synchronize`
