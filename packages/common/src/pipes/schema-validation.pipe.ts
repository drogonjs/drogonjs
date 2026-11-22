import { BadRequestException } from '../exceptions';
import type { PipeTransform } from '../interfaces';

/**
 * The Standard Schema interface (https://standardschema.dev), implemented by
 * Zod, Valibot, ArkType and others. Only the part this pipe calls is described.
 */
export interface StandardSchemaV1<Output = unknown> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    validate(value: unknown):
      | StandardSchemaResult<Output>
      | Promise<StandardSchemaResult<Output>>;
  };
}

type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> }> };

/**
 * Validates and parses a value with any Standard Schema, returning the
 * schema's output. `@Body(new SchemaValidationPipe(CreateCatSchema))`
 */
export class SchemaValidationPipe<Output = unknown> implements PipeTransform<unknown, Promise<Output>> {
  constructor(private readonly schema: StandardSchemaV1<Output>) {}

  async transform(value: unknown): Promise<Output> {
    const result = await this.schema['~standard'].validate(value);
    if (result.issues) {
      const message = result.issues.map(issue => {
        const path = (issue.path ?? []).map(part => String(typeof part === 'object' ? part.key : part)).join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
      throw new BadRequestException({ message, error: 'Bad Request' });
    }
    return result.value;
  }
}
