import { describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/mysql2';
import { DataSource, ILike, In, MoreThan } from '../src';
import { ENTITIES, Post, User } from './entities';
import { repositorySuite } from './repository-suite';

/**
 * A mock database records the SQL each repository call would send. The
 * mock cannot execute anything, so every call rejects after logging.
 */
function recordingDataSource() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const db = drizzle.mock({ mode: 'default', logger: { logQuery: (sql, params) => void queries.push({ sql, params }) } });
  return { dataSource: new DataSource({ dialect: 'mysql', db, entities: ENTITIES }), queries };
}

describe('Repository SQL (mysql)', () => {
  test('find builds a filtered, ordered, paged select', async () => {
    const { dataSource, queries } = recordingDataSource();
    await dataSource
      .getRepository(User)
      .find({ where: { age: MoreThan(18), name: ILike('a%') }, order: { name: 'DESC' }, skip: 10 })
      .catch(() => undefined);
    expect(queries[0]!.sql).toBe(
      'select `id`, `createdAt`, `updatedAt`, `name`, `email`, `age`, `active`, `role`, `settings` from `users` ' +
      'where (`users`.`age` > ? and lower(`users`.`name`) like lower(?)) order by `users`.`name` desc limit ? offset ?'
    );
    expect(queries[0]!.params).toEqual([18, 'a%', Number.MAX_SAFE_INTEGER, 10]);
  });

  test('soft-deletable entities filter on the delete date', async () => {
    const { dataSource, queries } = recordingDataSource();
    await dataSource.getRepository(Post).count({ where: { author: In([1, 2]) } }).catch(() => undefined);
    expect(queries[0]!.sql).toBe(
      'select count(*) from `post` where (`post`.`authorId` in (?, ?) and `post`.`deletedAt` is null)'
    );
  });

  test('upsert uses ON DUPLICATE KEY UPDATE', async () => {
    const { dataSource, queries } = recordingDataSource();
    await dataSource.getRepository(User).upsert({ name: 'A', email: 'a@x.io' }, ['email']).catch(() => undefined);
    expect(queries[0]!.sql).toMatch(/on duplicate key update .*`name` = values\(`name`\)/);
  });
});

// Runs the full suite against a real server when one is configured, e.g.
// MYSQL_URL=mysql://root:root@127.0.0.1:3306/drogon bun test packages/db
if (process.env.MYSQL_URL) {
  repositorySuite('mysql', async () => {
    const dataSource = new DataSource({ dialect: 'mysql', url: process.env.MYSQL_URL!, entities: ENTITIES });
    await dataSource.initialize();
    // Start from an empty schema so changes to the fixtures are picked up.
    for (const table of ['memberships', 'profile', 'post', 'users']) await dataSource.query(`DROP TABLE IF EXISTS \`${table}\``);
    await dataSource.synchronize();
    return dataSource;
  });
} else {
  test.skip('Repository (mysql): set MYSQL_URL to run against a server', () => {});
}
