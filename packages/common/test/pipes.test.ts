import { describe, expect, it } from 'bun:test';
import {
  BadRequestException,
  ConsoleLogger,
  DefaultValuePipe,
  HttpException,
  Logger,
  ParseArrayPipe,
  ParseBoolPipe,
  ParseDatePipe,
  ParseEnumPipe,
  ParseFloatPipe,
  ParseIntPipe,
  SchemaValidationPipe,
  type ArgumentMetadata,
  type LoggerService
} from '@drogonjs/common';

const meta: ArgumentMetadata = { type: 'query', data: 'x' };

enum Color {
  Red = 'red',
  Blue = 'blue'
}

enum Level {
  Low,
  High
}

describe('built-in pipes', () => {
  it('parses numbers and rejects garbage', async () => {
    expect(await new ParseIntPipe().transform('-12', meta)).toBe(-12);
    await expect(new ParseIntPipe().transform('12.5', meta)).rejects.toBeInstanceOf(BadRequestException);
    expect(await new ParseFloatPipe().transform('12.5', meta)).toBe(12.5);
    await expect(new ParseFloatPipe().transform('', meta)).rejects.toThrow('numeric string');
  });

  it('honours optional, custom status and exception factories', async () => {
    expect(await new ParseIntPipe({ optional: true }).transform(undefined, meta)).toBeUndefined();
    const error = await new ParseIntPipe({ errorHttpStatusCode: 422 }).transform('x', meta).catch(e => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(422);
    await expect(new ParseIntPipe({ exceptionFactory: message => new Error(`custom: ${message}`) }).transform('x', meta))
      .rejects.toThrow('custom: Validation failed');
  });

  it('parses booleans, enums, arrays and dates', async () => {
    expect(await new ParseBoolPipe().transform('true', meta)).toBe(true);
    await expect(new ParseBoolPipe().transform('yes', meta)).rejects.toThrow('boolean');
    expect(await new ParseEnumPipe(Color).transform('blue', meta)).toBe(Color.Blue);
    expect(await new ParseEnumPipe(Level).transform('1', meta)).toBe(Level.High);
    await expect(new ParseEnumPipe(Level).transform('High', meta)).rejects.toThrow('enum');
    expect(await new ParseArrayPipe({ items: new ParseIntPipe() }).transform('1,2,3', meta)).toEqual([1, 2, 3]);
    expect((await new ParseDatePipe().transform('2026-01-02', meta))?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
    expect(new DefaultValuePipe(5).transform(undefined)).toBe(5);
    expect(new DefaultValuePipe(5).transform(0)).toBe(0);
  });

  it('validates with any Standard Schema', async () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: (value: unknown) =>
          typeof (value as { name?: unknown })?.name === 'string'
            ? { value: { name: (value as { name: string }).name.toUpperCase() } }
            : { issues: [{ message: 'expected string', path: ['name'] }] }
      }
    };
    const pipe = new SchemaValidationPipe(schema);
    expect(await pipe.transform({ name: 'tom' })).toEqual({ name: 'TOM' });
    const error = await pipe.transform({}).catch(e => e);
    expect(error.toJSON()).toEqual({ statusCode: 400, message: ['name: expected string'], error: 'Bad Request' });
  });
});

describe('Logger', () => {
  it('routes contextual and static calls through the overriding logger', () => {
    const lines: unknown[][] = [];
    const capture: LoggerService = {
      log: (...args) => lines.push(['log', ...args]),
      error: (...args) => lines.push(['error', ...args]),
      warn: (...args) => lines.push(['warn', ...args])
    };
    Logger.overrideLogger(capture);
    try {
      new Logger('Users').log('created');
      Logger.warn('careful', 'Static');
      new Logger('Users').debug('falls back to log');
      expect(lines).toEqual([
        ['log', 'created', 'Users'],
        ['warn', 'careful', 'Static'],
        ['log', 'falls back to log', 'Users']
      ]);
    } finally {
      Logger.overrideLogger(true);
    }
  });

  it('filters ConsoleLogger output by level', () => {
    const logger = new ConsoleLogger('Test', { logLevels: ['error'] });
    expect(logger.isLevelEnabled('log')).toBe(false);
    expect(logger.isLevelEnabled('error')).toBe(true);
  });
});
