import { Injectable } from '../decorators/injectable.decorator';
import { Optional } from '../decorators/inject.decorator';
import { BadRequestException, HttpException } from '../exceptions';
import { HttpStatus } from '../http-status';
import type { ArgumentMetadata, PipeTransform } from '../interfaces';

/** The subset of class-validator's `ValidationError` this pipe reads. */
export interface ValidationError {
  property: string;
  value?: unknown;
  constraints?: Record<string, string>;
  children?: ValidationError[];
}

export interface ValidationPipeOptions {
  /** Returns the class instance built from the payload, and converts primitive params and queries. */
  transform?: boolean;
  /** Strips properties that carry no validation decorator. */
  whitelist?: boolean;
  /** With `whitelist`, rejects such properties instead of stripping them. */
  forbidNonWhitelisted?: boolean;
  forbidUnknownValues?: boolean;
  skipMissingProperties?: boolean;
  skipNullProperties?: boolean;
  skipUndefinedProperties?: boolean;
  groups?: string[];
  /** Hides the per-field messages from the response. */
  disableErrorMessages?: boolean;
  errorHttpStatusCode?: number;
  exceptionFactory?: (errors: ValidationError[]) => unknown;
  /** Only validate these argument types, e.g. `['body']`. */
  validateCustomDecorators?: boolean;
  /** Passed to class-transformer's `plainToInstance`. */
  transformOptions?: Record<string, unknown>;
  /** Used when the parameter's emitted type carries no information. */
  expectedType?: new (...args: any[]) => unknown;
  /** Supplies the libraries instead of importing `class-validator` and `class-transformer`. */
  validatorPackage?: ValidatorPackage;
  transformerPackage?: TransformerPackage;
  [validatorOption: string]: unknown;
}

export interface ValidatorPackage {
  validate(object: object, options?: Record<string, unknown>): Promise<ValidationError[]>;
}

export interface TransformerPackage {
  plainToInstance(cls: new (...args: any[]) => unknown, plain: unknown, options?: Record<string, unknown>): any;
  classToPlain?(object: unknown, options?: Record<string, unknown>): unknown;
}

const PRIMITIVES = new Set<unknown>([String, Boolean, Number, Array, Object, Buffer, Date]);

const OWN_OPTIONS = new Set([
  'transform',
  'disableErrorMessages',
  'errorHttpStatusCode',
  'exceptionFactory',
  'validateCustomDecorators',
  'transformOptions',
  'expectedType',
  'validatorPackage',
  'transformerPackage'
]);

/**
 * Validates DTO classes with class-validator, after turning the plain payload
 * into an instance with class-transformer. Both are optional peer dependencies,
 * imported the first time a payload needs validating.
 */
@Injectable()
export class ValidationPipe implements PipeTransform {
  private packages?: Promise<{ validator: ValidatorPackage; transformer: TransformerPackage }>;
  private readonly validatorOptions: Record<string, unknown>;

  constructor(@Optional() private readonly options: ValidationPipeOptions = {}) {
    this.validatorOptions = Object.fromEntries(Object.entries(options).filter(([key]) => !OWN_OPTIONS.has(key)));
  }

  async transform(value: unknown, metadata: ArgumentMetadata) {
    const metatype = (this.options.expectedType ?? metadata.metatype) as (new (...args: any[]) => unknown) | undefined;
    if (metadata.type === 'custom' && !this.options.validateCustomDecorators) return value;

    if (!metatype || PRIMITIVES.has(metatype)) {
      return this.options.transform ? transformPrimitive(value, metadata) : value;
    }

    const { validator, transformer } = await this.loadPackages();
    const instance =
      value !== null && typeof value === 'object'
        ? transformer.plainToInstance(metatype, value, this.options.transformOptions)
        : value;

    // class-validator only inspects objects; anything else is a malformed body.
    if (instance === null || typeof instance !== 'object') {
      this.fail([{ property: '', constraints: { isObject: 'payload must be an object' } }]);
    }

    const errors = await validator.validate(instance as object, this.validatorOptions);
    if (errors.length) this.fail(errors);
    return this.options.transform ? instance : value;
  }

  private fail(errors: ValidationError[]): never {
    if (this.options.exceptionFactory) throw this.options.exceptionFactory(errors);
    const status = this.options.errorHttpStatusCode ?? HttpStatus.BAD_REQUEST;
    if (this.options.disableErrorMessages) throw new HttpException(status, 'Bad Request');
    const response = { message: flattenErrors(errors), error: 'Bad Request' };
    throw status === HttpStatus.BAD_REQUEST ? new BadRequestException(response) : new HttpException(status, response);
  }

  private loadPackages() {
    this.packages ??= (async () => {
      try {
        const validator = this.options.validatorPackage ?? ((await import('class-validator' as string)) as ValidatorPackage);
        const transformer =
          this.options.transformerPackage ?? ((await import('class-transformer' as string)) as TransformerPackage);
        return { validator, transformer };
      } catch (error) {
        this.packages = undefined;
        throw new Error(
          '[DrogonJS] ValidationPipe needs the "class-validator" and "class-transformer" packages. ' +
          'Install them, or validate with SchemaValidationPipe instead.',
          { cause: error }
        );
      }
    })();
    return this.packages;
  }
}

function transformPrimitive(value: unknown, metadata: ArgumentMetadata) {
  if (metadata.type !== 'param' && metadata.type !== 'query') return value;
  if (metadata.metatype === Number && typeof value === 'string' && value !== '') return Number(value);
  if (metadata.metatype === Boolean && typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return value;
}

/** `["name must be a string", "address.city should not be empty"]` */
export function flattenErrors(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap(error => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map(message =>
      parent ? message.replace(error.property, path) : message
    );
    return [...own, ...flattenErrors(error.children ?? [], path)];
  });
}
