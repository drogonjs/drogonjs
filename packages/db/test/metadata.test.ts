import { describe, expect, test } from 'bun:test';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  Column,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  buildSchema,
  createSchemaStatements,
  defaultTableName,
  getEntityMetadata,
  toTable
} from '../src';
import { ENTITIES, Membership, Post, Profile, User } from './entities';

describe('entity metadata', () => {
  test('table names default to the snake_cased class name', () => {
    expect(defaultTableName('User')).toBe('user');
    expect(defaultTableName('UserProfile')).toBe('user_profile');
    expect(defaultTableName('HTTPRequestLog')).toBe('http_request_log');
    expect(getEntityMetadata(Post).tableName).toBe('post');
    expect(getEntityMetadata(User).tableName).toBe('users');
  });

  test('column types are inferred from TypeScript types', () => {
    const user = getEntityMetadata(User);
    const typeOf = (name: string) => user.findColumn(name)!.type;
    expect(typeOf('name')).toBe('varchar');
    expect(typeOf('age')).toBe('integer');
    expect(typeOf('active')).toBe('boolean');
    expect(typeOf('createdAt')).toBe('timestamp');
    expect(user.findColumn('role')!.enumValues).toEqual(['admin', 'member']);
  });

  test('inherited columns are included, primary keys first', () => {
    const user = getEntityMetadata(User);
    expect(user.columns[0]!.propertyName).toBe('id');
    expect(user.createDateColumn?.propertyName).toBe('createdAt');
    expect(user.updateDateColumn?.propertyName).toBe('updatedAt');
  });

  test('many-to-one adds a <property>Id join column typed like the referenced key', () => {
    const post = getEntityMetadata(Post);
    const author = post.findRelation('author')!;
    expect(author.owner).toBe(true);
    expect(author.joinColumn).toMatchObject({ propertyName: 'authorId', databaseName: 'authorId', type: 'integer', nullable: true });
    expect(author.referencedColumn!.propertyName).toBe('id');
    expect(author.inversePropertyName).toBe('posts');
  });

  test('@JoinColumn names the column; the inverse side owns nothing', () => {
    const profile = getEntityMetadata(Profile).findRelation('user')!;
    expect(profile.owner).toBe(true);
    expect(profile.joinColumn).toMatchObject({ databaseName: 'user_id', unique: true });
    const inverse = getEntityMetadata(User).findRelation('profile')!;
    expect(inverse.owner).toBe(false);
    expect(inverse.joinColumn).toBeUndefined();
  });

  test('an explicitly declared column doubles as the join column', () => {
    @Entity()
    class Owner {
      @PrimaryGeneratedColumn('uuid') id!: string;
    }
    @Entity()
    class Pet {
      @PrimaryGeneratedColumn() id!: number;
      @Column({ type: 'uuid' }) ownerId!: string;
      @ManyToOne(() => Owner) owner!: Owner;
    }
    const pet = getEntityMetadata(Pet);
    expect(pet.columns.filter(column => column.propertyName === 'ownerId')).toHaveLength(1);
    expect(pet.findRelation('owner')!.joinColumn!.relationProperty).toBe('owner');
  });

  test('self-referencing relations resolve', () => {
    @Entity()
    class Category {
      @PrimaryGeneratedColumn() id!: number;
      @ManyToOne(() => Category, { onDelete: 'SET NULL' }) parent!: Category | null;
    }
    const join = getEntityMetadata(Category).findRelation('parent')!.joinColumn!;
    expect(join.type).toBe('integer');
    expect(createSchemaStatements([Category], 'postgres')[0]).toContain(
      'FOREIGN KEY ("parentId") REFERENCES "category" ("id") ON DELETE SET NULL'
    );
  });

  test('a class without @Entity is rejected', () => {
    class Plain {}
    expect(() => getEntityMetadata(Plain)).toThrow(/not an entity/);
  });
});

describe('drizzle tables', () => {
  test('keys are property names, columns are database names', () => {
    const table = toTable(Profile, 'postgres');
    expect(getTableName(table)).toBe('profile');
    const columns = getTableColumns(table);
    expect(Object.keys(columns).sort()).toEqual(['bio', 'id', 'userId']);
    expect(columns.userId!.name).toBe('user_id');
    expect(getTableConfig(table).foreignKeys).toHaveLength(1);
  });

  test('tables are cached per entity and dialect', () => {
    expect(toTable(User, 'sqlite')).toBe(toTable(User, 'sqlite'));
    expect(toTable(User, 'sqlite')).not.toBe(toTable(User, 'postgres'));
  });

  test('buildSchema keys tables by class name', () => {
    const schema = buildSchema(ENTITIES, 'mysql');
    expect(Object.keys(schema)).toEqual(['User', 'Post', 'Profile', 'Membership']);
    expect(getTableName(schema.Membership)).toBe('memberships');
  });
});

describe('synchronize DDL', () => {
  test('referenced tables come first and related entities are included', () => {
    const statements = createSchemaStatements([Post], 'postgres');
    expect(statements.map(statement => statement.match(/TABLE IF NOT EXISTS "(\w+)"/)?.[1])).toEqual(['users', 'post', 'profile']);
  });

  test('postgres', () => {
    const [users, post, profile, memberships, index] = createSchemaStatements(ENTITIES, 'postgres');
    expect(users).toContain('"id" serial NOT NULL PRIMARY KEY');
    expect(users).toContain('"email" varchar(120) NOT NULL UNIQUE');
    expect(users).toContain('"createdAt" timestamp NOT NULL DEFAULT now()');
    expect(users).toContain(`"role" varchar(255) NOT NULL DEFAULT 'member'`);
    expect(post).toContain('CONSTRAINT "FK_post_authorId" FOREIGN KEY ("authorId") REFERENCES "users" ("id") ON DELETE CASCADE');
    expect(profile).toContain('"id" uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY');
    expect(memberships).toContain('PRIMARY KEY ("team", "userId")');
    expect(index).toBe('CREATE UNIQUE INDEX IF NOT EXISTS "IDX_memberships_team_userId" ON "memberships" ("team", "userId")');
  });

  test('sqlite', () => {
    const [users] = createSchemaStatements([User], 'sqlite');
    expect(users).toContain('"id" integer NOT NULL PRIMARY KEY AUTOINCREMENT');
    expect(users).toContain('"active" integer NOT NULL DEFAULT 1');
    expect(users).toContain('"createdAt" integer NOT NULL');
  });

  test('mysql', () => {
    const statements = createSchemaStatements(ENTITIES, 'mysql');
    const [users, , profile, memberships] = statements;
    expect(statements).toHaveLength(4);
    expect(users).toContain('`id` int NOT NULL AUTO_INCREMENT PRIMARY KEY');
    expect(users).toContain("`role` enum('admin','member') NOT NULL DEFAULT 'member'");
    expect(users).toContain('`updatedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)');
    expect(users).toContain('`age` int NULL');
    expect(profile).toContain('`id` varchar(36) NOT NULL PRIMARY KEY');
    expect(memberships).toContain('UNIQUE KEY `IDX_memberships_team_userId` (`team`, `userId`)');
    expect(getEntityMetadata(Membership).indices[0]!.unique).toBe(true);
  });
});
