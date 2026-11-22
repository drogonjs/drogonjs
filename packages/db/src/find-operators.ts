import type { SQL } from 'drizzle-orm';

export type FindOperatorType =
  | 'in'
  | 'not'
  | 'like'
  | 'ilike'
  | 'moreThan'
  | 'moreThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'
  | 'between'
  | 'isNull'
  | 'equal'
  | 'raw';

/** A comparison other than equality inside a `where` object. */
export class FindOperator<T = unknown> {
  constructor(
    readonly type: FindOperatorType,
    readonly value?: unknown
  ) {}

  /** @internal phantom field carrying the compared type */
  declare readonly __type?: T;
}

export const In = <T>(values: readonly T[]) => new FindOperator<T>('in', values);
/** Negates a value (`<>`) or another operator. */
export const Not = <T>(value: T | FindOperator<T>) => new FindOperator<T>('not', value);
export const Like = (pattern: string) => new FindOperator<string>('like', pattern);
/** Case-insensitive `LIKE`: native on Postgres, `lower()` on both sides elsewhere. */
export const ILike = (pattern: string) => new FindOperator<string>('ilike', pattern);
export const MoreThan = <T>(value: T) => new FindOperator<T>('moreThan', value);
export const MoreThanOrEqual = <T>(value: T) => new FindOperator<T>('moreThanOrEqual', value);
export const LessThan = <T>(value: T) => new FindOperator<T>('lessThan', value);
export const LessThanOrEqual = <T>(value: T) => new FindOperator<T>('lessThanOrEqual', value);
export const Between = <T>(from: T, to: T) => new FindOperator<T>('between', [from, to]);
export const IsNull = () => new FindOperator<any>('isNull');
export const Equal = <T>(value: T) => new FindOperator<T>('equal', value);
/** Arbitrary SQL against the column: `Raw(column => sql\`${column} % 2 = 0\`)`. */
export const Raw = (build: (column: unknown) => SQL) => new FindOperator<any>('raw', build);
