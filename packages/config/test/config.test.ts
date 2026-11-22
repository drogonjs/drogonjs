import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Inject, Injectable, Module } from '@drogonjs/common';
import { ApplicationContext } from '@drogonjs/core';
import { ConfigModule, ConfigService, expandVariables, parseDotenv, registerAs, type ConfigType } from '../src/index';

const touched: string[] = [];
afterEach(() => {
  for (const key of touched.splice(0)) delete process.env[key];
});

function envFile(content: string) {
  const dir = mkdtempSync(join(tmpdir(), 'drogon-config-'));
  const path = join(dir, '.env');
  writeFileSync(path, content);
  return path;
}

const database = registerAs('database', () => ({ host: 'localhost', port: 5432 }));

describe('dotenv parsing', () => {
  it('handles quotes, comments, export and escapes', () => {
    expect(
      parseDotenv(['# comment', 'export A=1', 'B="two\\nlines"', "C='single # not comment'", 'D=bare # comment', 'E='].join('\n'))
    ).toEqual({ A: '1', B: 'two\nlines', C: 'single # not comment', D: 'bare', E: '' });
  });

  it('expands references with fallbacks', () => {
    expect(expandVariables({ HOST: 'db', URL: 'pg://${HOST}:${PORT:-5432}/$NAME' }, { NAME: 'app' })).toEqual({
      HOST: 'db',
      URL: 'pg://db:5432/app'
    });
  });
});

describe('ConfigModule', () => {
  it('reads env files, process.env and loaded factories, with dotted paths', async () => {
    touched.push('DROGON_TEST_PORT', 'DROGON_TEST_NAME');
    process.env.DROGON_TEST_NAME = 'from-process';
    const path = envFile('DROGON_TEST_PORT=8080\nDROGON_TEST_NAME=from-file\n');

    const app = await ApplicationContext.create(
      ConfigModule.forRoot({ envFilePath: path, load: [database, () => ({ feature: { enabled: true } })] })
    );
    const config = await app.get(ConfigService);
    expect(config.get('DROGON_TEST_PORT')).toBe('8080');
    expect(config.get('DROGON_TEST_NAME')).toBe('from-process');
    expect(config.get('database.port')).toBe(5432);
    expect(config.get('feature.enabled')).toBe(true);
    expect(config.get('missing', 'fallback')).toBe('fallback');
    expect(() => config.getOrThrow('missing')).toThrow('does not exist');
    expect(await app.get(database.KEY)).toEqual({ host: 'localhost', port: 5432 });
  });

  it('validates and converts the environment', async () => {
    touched.push('DROGON_TEST_LIMIT');
    process.env.DROGON_TEST_LIMIT = '10';
    const app = await ApplicationContext.create(
      ConfigModule.forRoot({
        ignoreEnvFile: true,
        validate: env => ({ ...env, DROGON_TEST_LIMIT: Number(env.DROGON_TEST_LIMIT) })
      })
    );
    expect((await app.get(ConfigService)).get('DROGON_TEST_LIMIT')).toBe(10);

    await expect(
      ApplicationContext.create(
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          validationSchema: {
            '~standard': { validate: () => ({ issues: [{ message: 'is required', path: ['SECRET'] }] }) }
          }
        })
      )
    ).rejects.toThrow('SECRET: is required');
  });

  it('is injectable everywhere when global, with forFeature namespaces', async () => {
    const mail = registerAs('mail', () => ({ from: 'noreply@example.com' }));

    @Injectable()
    class Mailer {
      constructor(
        readonly config: ConfigService,
        @Inject(mail.KEY) readonly mailConfig: ConfigType<typeof mail>
      ) {}
    }

    @Module({ imports: [ConfigModule.forFeature(mail)], providers: [Mailer] })
    class MailModule {}

    @Module({ imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), MailModule] })
    class AppModule {}

    const app = await ApplicationContext.create(AppModule);
    const mailer = await app.get(Mailer);
    expect(mailer.mailConfig.from).toBe('noreply@example.com');
    expect(mailer.config.get('mail.from')).toBe('noreply@example.com');
  });
});
