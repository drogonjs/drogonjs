import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { DataSource } from '../src';
import { ENTITIES } from './entities';
import { repositorySuite } from './repository-suite';

repositorySuite('postgres via pglite', () =>
  new DataSource({ dialect: 'postgres', db: drizzle(new PGlite()), entities: ENTITIES, synchronize: true }).initialize()
);
