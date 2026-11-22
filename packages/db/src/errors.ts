import { NotFoundException } from '@drogonjs/common';

/**
 * Thrown by `findOneOrFail` and friends. Extends `NotFoundException`, so an
 * uncaught one becomes a 404 instead of a 500.
 */
export class EntityNotFoundError extends NotFoundException {
  constructor(entity: Function | string, criteria: unknown) {
    const name = typeof entity === 'string' ? entity : entity.name;
    super(`Could not find any entity of type "${name}" matching: ${describe(criteria)}`);
    this.name = 'EntityNotFoundError';
  }
}

function describe(criteria: unknown): string {
  try {
    return JSON.stringify(criteria, (_key, value) =>
      value && typeof value === 'object' && value.constructor?.name === 'FindOperator'
        ? { [value.type]: value.value }
        : value
    ) ?? String(criteria);
  } catch {
    return String(criteria);
  }
}
