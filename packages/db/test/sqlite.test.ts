import { DataSource } from '../src';
import { ENTITIES } from './entities';
import { repositorySuite } from './repository-suite';

repositorySuite('sqlite', () => new DataSource({ dialect: 'sqlite', url: ':memory:', entities: ENTITIES, synchronize: true }).initialize());
