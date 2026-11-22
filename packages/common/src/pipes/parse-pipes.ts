import { Injectable } from '../decorators/injectable.decorator';
import { Optional } from '../decorators/inject.decorator';
import { BadRequestException, HttpException } from '../exceptions';
import { HttpStatus } from '../http-status';
import type { ArgumentMetadata, PipeTransform } from '../interfaces';

export interface ParsePipeOptions {
  /** Status of the exception thrown for invalid input. Defaults to 400. */
  errorHttpStatusCode?: number;
  exceptionFactory?: (error: string) => unknown;
  /** Lets `undefined` and `null` through untouched instead of rejecting them. */
  optional?: boolean;
}

/**
 * Shared by the parse pipes. Each is decorated so that, used as a class
 * (`@Param('id', ParseIntPipe)`), the container builds it with no options.
 */
abstract class ParsePipe<R> implements PipeTransform<unknown, R | undefined | null> {
  constructor(protected readonly options: ParsePipeOptions = {}) {}

  protected abstract parse(value: unknown, metadata: ArgumentMetadata): R | Promise<R>;

  async transform(value: unknown, metadata: ArgumentMetadata) {
    if ((value === undefined || value === null) && this.options.optional) return value as undefined | null;
    return this.parse(value, metadata);
  }

  protected fail(message: string): never {
    if (this.options.exceptionFactory) throw this.options.exceptionFactory(message);
    const status = this.options.errorHttpStatusCode ?? HttpStatus.BAD_REQUEST;
    throw status === HttpStatus.BAD_REQUEST
      ? new BadRequestException(message)
      : new HttpException(status, message);
  }
}

@Injectable()
export class ParseIntPipe extends ParsePipe<number> {
  constructor(@Optional() options?: ParsePipeOptions) {
    super(options);
  }

  protected parse(value: unknown) {
    const text = String(value ?? '');
    if (!/^-?\d+$/.test(text.trim())) this.fail('Validation failed (numeric string is expected)');
    return Number.parseInt(text, 10);
  }
}

@Injectable()
export class ParseFloatPipe extends ParsePipe<number> {
  constructor(@Optional() options?: ParsePipeOptions) {
    super(options);
  }

  protected parse(value: unknown) {
    const text = String(value ?? '').trim();
    const parsed = Number(text);
    if (!text || !Number.isFinite(parsed)) this.fail('Validation failed (numeric string is expected)');
    return parsed;
  }
}

@Injectable()
export class ParseBoolPipe extends ParsePipe<boolean> {
  constructor(@Optional() options?: ParsePipeOptions) {
    super(options);
  }

  protected parse(value: unknown) {
    if (value === true || value === 'true') return true;
    if (value === false || value === 'false') return false;
    return this.fail('Validation failed (boolean string is expected)');
  }
}

export interface ParseUUIDPipeOptions extends ParsePipeOptions {
  version?: '3' | '4' | '5' | '7' | 'all';
}

const UUID_PATTERNS: Record<NonNullable<ParseUUIDPipeOptions['version']>, RegExp> = {
  '3': /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  '4': /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  '5': /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  '7': /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  all: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
};

@Injectable()
export class ParseUUIDPipe extends ParsePipe<string> {
  constructor(@Optional() protected readonly uuidOptions: ParseUUIDPipeOptions = {}) {
    super(uuidOptions);
  }

  protected parse(value: unknown) {
    const version = this.uuidOptions.version ?? 'all';
    if (typeof value !== 'string' || !UUID_PATTERNS[version].test(value)) {
      this.fail(`Validation failed (uuid${version === 'all' ? '' : ` v${version}`} is expected)`);
    }
    return value as string;
  }
}

@Injectable()
export class ParseEnumPipe<T extends Record<string, string | number> = any> extends ParsePipe<T[keyof T]> {
  private readonly values: Array<string | number>;

  constructor(enumType: T, @Optional() options?: ParsePipeOptions) {
    super(options);
    if (!enumType) throw new Error('[DrogonJS] ParseEnumPipe needs the enum to validate against');
    // Numeric enums carry reverse mappings, which are not valid values.
    this.values = Object.keys(enumType)
      .filter(key => !/^\d+$/.test(key))
      .map(key => enumType[key]!);
  }

  protected parse(value: unknown) {
    const match = this.values.find(candidate => String(candidate) === String(value));
    if (match === undefined) this.fail('Validation failed (enum string is expected)');
    return match as T[keyof T];
  }
}

export interface ParseArrayPipeOptions extends ParsePipeOptions {
  /** Splits a string input. Defaults to `','`. */
  separator?: string;
  /** Applied to every item, e.g. `new ParseIntPipe()`. */
  items?: PipeTransform;
}

@Injectable()
export class ParseArrayPipe extends ParsePipe<unknown[]> {
  constructor(@Optional() protected readonly arrayOptions: ParseArrayPipeOptions = {}) {
    super(arrayOptions);
  }

  protected async parse(value: unknown, metadata: ArgumentMetadata) {
    let items: unknown[];
    if (Array.isArray(value)) items = value;
    else if (typeof value === 'string') items = value === '' ? [] : value.split(this.arrayOptions.separator ?? ',');
    else return this.fail('Validation failed (parsable array expected)');

    const itemPipe = this.arrayOptions.items;
    if (!itemPipe) return items;
    return Promise.all(items.map(item => itemPipe.transform(item, { ...metadata, metatype: undefined })));
  }
}

@Injectable()
export class ParseDatePipe extends ParsePipe<Date> {
  constructor(@Optional() options?: ParsePipeOptions) {
    super(options);
  }

  protected parse(value: unknown) {
    const date = value instanceof Date ? value : new Date(typeof value === 'number' ? value : String(value ?? ''));
    if (Number.isNaN(date.getTime())) this.fail('Validation failed (date string is expected)');
    return date;
  }
}

/** Substitutes `defaultValue` for `undefined`, `null` and `NaN`. Place it before a parse pipe. */
export class DefaultValuePipe<T = unknown> implements PipeTransform<unknown, unknown> {
  constructor(private readonly defaultValue: T) {}

  transform(value: unknown) {
    if (value === undefined || value === null || (typeof value === 'number' && Number.isNaN(value))) {
      return this.defaultValue;
    }
    return value;
  }
}
