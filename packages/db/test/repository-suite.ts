import { beforeAll, beforeEach, afterAll, describe, expect, test } from 'bun:test';
import {
  Between,
  DataSource,
  EntityNotFoundError,
  ILike,
  In,
  IsNull,
  LessThan,
  Like,
  MoreThan,
  MoreThanOrEqual,
  Not,
  Raw,
  type Repository
} from '../src';
import { sql } from 'drizzle-orm';
import { Membership, Post, Profile, Role, User } from './entities';

/** The same behaviour is asserted against every dialect that runs in-process. */
export function repositorySuite(label: string, createDataSource: () => Promise<DataSource>) {
  describe(`Repository (${label})`, () => {
    let dataSource: DataSource;
    let users: Repository<User>;
    let posts: Repository<Post>;
    let profiles: Repository<Profile>;

    beforeAll(async () => {
      dataSource = await createDataSource();
      users = dataSource.getRepository(User);
      posts = dataSource.getRepository(Post);
      profiles = dataSource.getRepository(Profile);
    });

    afterAll(async () => {
      await dataSource.destroy();
    });

    beforeEach(async () => {
      await dataSource.getRepository(Membership).clear();
      await profiles.clear();
      await posts.clear();
      await users.clear();
    });

    const seed = async () => {
      const [ada, bob, cy] = await users.save([
        users.create({ name: 'Ada', email: 'ada@x.io', age: 36 }),
        users.create({ name: 'Bob', email: 'bob@x.io', age: 25, role: Role.Admin }),
        users.create({ name: 'Cy', email: 'cy@x.io', age: null })
      ]);
      return { ada: ada!, bob: bob!, cy: cy! };
    };

    test('save inserts and returns generated values on the same instance', async () => {
      const user = users.create({ name: 'Ada', email: 'ada@x.io' });
      const saved = await users.save(user);
      expect(saved).toBe(user);
      expect(typeof user.id).toBe('number');
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
      expect(user.active).toBe(true);
      expect(user.role).toBe(Role.Member);
      expect(user).toBeInstanceOf(User);
    });

    test('save updates an existing row and refreshes the update date', async () => {
      const user = await users.save(users.create({ name: 'Ada', email: 'ada@x.io' }));
      const createdAt = user.createdAt.getTime();
      const before = user.updatedAt.getTime();
      await Bun.sleep(5);
      user.name = 'Ada L.';
      await users.save(user);
      const reloaded = await users.findOneByOrFail({ id: user.id });
      expect(reloaded.name).toBe('Ada L.');
      expect(reloaded.createdAt.getTime()).toBe(createdAt);
      expect(reloaded.updatedAt.getTime()).toBeGreaterThan(before);
      expect(await users.count()).toBe(1);
    });

    test('found rows are entity instances with their methods', async () => {
      await seed();
      const ada = await users.findOneBy({ name: 'Ada' });
      expect(ada).toBeInstanceOf(User);
      expect(ada!.greet()).toBe('hi Ada');
    });

    test('json columns round-trip', async () => {
      const user = await users.save(users.create({ name: 'J', email: 'j@x.io', settings: { theme: 'dark' } }));
      expect((await users.findOneByOrFail({ id: user.id })).settings).toEqual({ theme: 'dark' });
    });

    test('where operators', async () => {
      await seed();
      const names = (list: User[]) => list.map(user => user.name).sort();
      expect(names(await users.findBy({ age: MoreThan(30) }))).toEqual(['Ada']);
      expect(names(await users.findBy({ age: MoreThanOrEqual(25) }))).toEqual(['Ada', 'Bob']);
      expect(names(await users.findBy({ age: LessThan(30) }))).toEqual(['Bob']);
      expect(names(await users.findBy({ age: Between(20, 40) }))).toEqual(['Ada', 'Bob']);
      expect(names(await users.findBy({ age: IsNull() }))).toEqual(['Cy']);
      expect(names(await users.findBy({ age: null }))).toEqual(['Cy']);
      expect(names(await users.findBy({ age: Not(IsNull()) }))).toEqual(['Ada', 'Bob']);
      expect(names(await users.findBy({ name: Not('Ada') }))).toEqual(['Bob', 'Cy']);
      expect(names(await users.findBy({ name: In(['Ada', 'Cy']) }))).toEqual(['Ada', 'Cy']);
      expect(names(await users.findBy({ email: Like('%@x.io'), name: Like('B%') }))).toEqual(['Bob']);
      expect(names(await users.findBy({ name: ILike('ad%') }))).toEqual(['Ada']);
      expect(names(await users.findBy({ role: Role.Admin }))).toEqual(['Bob']);
      expect(names(await users.findBy({ age: Raw(column => sql`${column} % 2 = 0`) }))).toEqual(['Ada']);
      // An array of objects is an OR; undefined values are ignored.
      expect(names(await users.findBy([{ name: 'Ada' }, { age: 25, email: undefined }]))).toEqual(['Ada', 'Bob']);
      expect(await users.findBy({ name: In([]) })).toEqual([]);
    });

    test('order, skip and take', async () => {
      await seed();
      const ordered = await users.find({ order: { name: 'DESC' } });
      expect(ordered.map(user => user.name)).toEqual(['Cy', 'Bob', 'Ada']);
      const page = await users.find({ order: { name: 'ASC' }, skip: 1, take: 1 });
      expect(page.map(user => user.name)).toEqual(['Bob']);
      const rest = await users.find({ order: { name: 'ASC' }, skip: 1 });
      expect(rest.map(user => user.name)).toEqual(['Bob', 'Cy']);
      const [rows, total] = await users.findAndCount({ order: { name: 'ASC' }, take: 2 });
      expect(rows).toHaveLength(2);
      expect(total).toBe(3);
    });

    test('select reads only the chosen columns plus the primary key', async () => {
      await seed();
      const [ada] = await users.find({ select: ['name'], where: { name: 'Ada' } });
      expect(Object.keys(ada!).sort()).toEqual(['id', 'name']);
      const [bob] = await users.find({ select: { email: true }, where: { name: 'Bob' } });
      expect(bob!.email).toBe('bob@x.io');
    });

    test('count, exists and the OrFail variants', async () => {
      await seed();
      expect(await users.count()).toBe(3);
      expect(await users.countBy({ role: Role.Member })).toBe(2);
      expect(await users.existsBy({ name: 'Bob' })).toBe(true);
      expect(await users.exists({ where: { name: 'Zed' } })).toBe(false);
      expect(await users.findOneBy({ name: 'Zed' })).toBeNull();
      await expect(users.findOneByOrFail({ name: 'Zed' })).rejects.toBeInstanceOf(EntityNotFoundError);
      await expect(users.findOneOrFail({ where: { name: 'Zed' } })).rejects.toThrow(/User/);
    });

    test('insert, update, delete and increment report affected rows', async () => {
      const { identifiers, generatedMaps } = await users.insert([
        { name: 'A', email: 'a@x.io', age: 1 },
        { name: 'B', email: 'b@x.io', age: 2 }
      ]);
      expect(identifiers).toHaveLength(2);
      expect(generatedMaps[0]).toBeInstanceOf(User);
      const [first, second] = identifiers.map(identifier => identifier.id as number);

      expect(await users.update({ age: MoreThan(0) }, { active: false })).toEqual({ affected: 2 });
      expect(await users.countBy({ active: false })).toBe(2);
      expect(await users.update(first!, { name: 'A2' })).toEqual({ affected: 1 });
      expect((await users.findOneByOrFail({ id: first })).name).toBe('A2');

      await users.increment({ id: second }, 'age', 5);
      expect((await users.findOneByOrFail({ id: second })).age).toBe(7);
      await users.decrement({ id: second }, 'age', 2);
      expect((await users.findOneByOrFail({ id: second })).age).toBe(5);

      expect(await users.delete([first!, second!])).toEqual({ affected: 2 });
      expect(await users.count()).toBe(0);
      await expect(users.delete({})).rejects.toThrow(/needs criteria/);
    });

    test('remove deletes by primary key and clears it', async () => {
      const { ada } = await seed();
      const id = ada.id;
      await users.remove(ada);
      expect(ada.id).toBeUndefined();
      expect(await users.existsBy({ id })).toBe(false);
    });

    test('upsert inserts then updates on conflict', async () => {
      await users.upsert({ name: 'Ada', email: 'ada@x.io', age: 1 }, ['email']);
      const { generatedMaps } = await users.upsert({ name: 'Ada', email: 'ada@x.io', age: 2 }, ['email']);
      expect(generatedMaps[0]!.age).toBe(2);
      expect(await users.count()).toBe(1);
    });

    test('many-to-one: saving with a relation object writes the key, and relations load', async () => {
      const { ada, bob } = await seed();
      await posts.save([
        posts.create({ title: 'One', author: ada }),
        posts.create({ title: 'Two', author: ada }),
        posts.create({ title: 'Three', author: bob })
      ]);

      const loaded = await posts.find({ relations: ['author'], order: { title: 'ASC' } });
      expect(loaded.map(post => [post.title, post.author.name])).toEqual([
        ['One', 'Ada'],
        ['Three', 'Bob'],
        ['Two', 'Ada']
      ]);
      expect(loaded[0]!.author).toBeInstanceOf(User);

      // Filtering by the relation goes through its join column.
      expect(await posts.countBy({ author: { id: ada.id } })).toBe(2);
      expect(await posts.countBy({ author: bob })).toBe(1);
      expect(await posts.countBy({ author: In([ada.id, bob.id]) })).toBe(3);
      await expect(posts.findBy({ author: { name: 'Ada' } as any })).rejects.toThrow(/can only be filtered by "id"/);
    });

    test('one-to-many and nested relations', async () => {
      const { ada, cy } = await seed();
      await posts.save([posts.create({ title: 'One', author: ada }), posts.create({ title: 'Two', author: ada })]);

      const withPosts = await users.find({ relations: { posts: true }, order: { name: 'ASC' } });
      expect(withPosts.find(user => user.id === ada.id)!.posts.map(post => post.title).sort()).toEqual(['One', 'Two']);
      expect(withPosts.find(user => user.id === cy.id)!.posts).toEqual([]);

      const nested = await posts.findOneOrFail({ where: { title: 'One' }, relations: ['author.posts'] });
      expect(nested.author.posts).toHaveLength(2);
    });

    test('one-to-one with a custom join column, both directions', async () => {
      const { ada } = await seed();
      const profile = await profiles.save(profiles.create({ bio: 'math', user: ada }));
      expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);

      const owner = await profiles.findOneOrFail({ where: { id: profile.id }, relations: ['user'] });
      expect(owner.user.name).toBe('Ada');
      const inverse = await users.findOneOrFail({ where: { id: ada.id }, relations: ['profile'] });
      expect(inverse.profile.bio).toBe('math');
      const bob = await users.findOneOrFail({ where: { name: 'Bob' }, relations: ['profile'] });
      expect(bob.profile).toBeNull();
    });

    test('foreign keys are enforced, with ON DELETE CASCADE', async () => {
      const { ada } = await seed();
      await posts.save(posts.create({ title: 'One', author: ada }));
      await expect(posts.insert({ title: 'Orphan', author: { id: 999_999 } as User })).rejects.toThrow();
      await users.delete(ada.id);
      expect(await posts.count({ withDeleted: true })).toBe(0);
    });

    test('soft delete, restore and withDeleted', async () => {
      const { ada } = await seed();
      const [one, two] = await posts.save([posts.create({ title: 'One', author: ada }), posts.create({ title: 'Two', author: ada })]);

      expect(await posts.softDelete(one!.id)).toEqual({ affected: 1 });
      expect((await posts.find()).map(post => post.title)).toEqual(['Two']);
      expect(await posts.count({ withDeleted: true })).toBe(2);
      expect((await posts.findOne({ where: { id: one!.id }, withDeleted: true }))!.deletedAt).toBeInstanceOf(Date);

      await posts.restore(one!.id);
      expect(await posts.count()).toBe(2);

      await posts.softRemove(two!);
      expect(two!.deletedAt).toBeInstanceOf(Date);
      expect(await posts.count()).toBe(1);
      await posts.recover(two!);
      expect(two!.deletedAt).toBeNull();
      expect(await posts.count()).toBe(2);

      // Relations skip soft-deleted rows as well.
      await posts.softDelete({ title: 'Two' });
      const author = await users.findOneOrFail({ where: { id: ada.id }, relations: ['posts'] });
      expect(author.posts.map(post => post.title)).toEqual(['One']);
      await expect(users.softDelete(ada.id)).rejects.toThrow(/DeleteDateColumn/);
    });

    test('transactions commit, and roll back on error', async () => {
      await dataSource.transaction(async manager => {
        await manager.save(User, { name: 'T1', email: 't1@x.io' });
        await manager.getRepository(User).save(manager.create(User, { name: 'T2', email: 't2@x.io' }));
      });
      expect(await users.count()).toBe(2);

      await expect(
        dataSource.transaction(async manager => {
          await manager.save(User, { name: 'T3', email: 't3@x.io' });
          throw new Error('boom');
        })
      ).rejects.toThrow('boom');
      expect(await users.count()).toBe(2);
    });

    test('nested transactions roll back only the inner work', async () => {
      await dataSource.transaction(async outer => {
        await outer.save(User, { name: 'Outer', email: 'o@x.io' });
        await outer
          .transaction(async inner => {
            await inner.save(User, { name: 'Inner', email: 'i@x.io' });
            throw new Error('inner');
          })
          .catch(() => undefined);
      });
      expect((await users.find()).map(user => user.name)).toEqual(['Outer']);
    });

    test('composite primary keys', async () => {
      const memberships = dataSource.getRepository(Membership);
      await memberships.save(memberships.create({ team: 'core', userId: 1 }));
      const stamp = new Date('2024-01-01T00:00:00Z');
      const existing = memberships.create({ team: 'core', userId: 1, joinedAt: stamp });
      await memberships.save(existing);
      expect(await memberships.count()).toBe(1);
      expect((await memberships.findOneByOrFail({ team: 'core', userId: 1 })).joinedAt!.getTime()).toBe(stamp.getTime());
      await expect(memberships.delete(1)).rejects.toThrow(/exactly one primary column/);
    });

    test('raw queries', async () => {
      await seed();
      const rows = await dataSource.query<{ total: number | string }>('SELECT count(*) AS total FROM users');
      expect(Number(rows[0]!.total)).toBe(3);
    });
  });
}
