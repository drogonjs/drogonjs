export const METADATA_KEYS = {
  MODULE: Symbol.for('drogonjs:module'),
  INJECTABLE: Symbol.for('drogonjs:injectable'),
  CONTROLLER: Symbol.for('drogonjs:controller'),
  ROUTES: Symbol.for('drogonjs:routes'),
  ROUTE_ARGS: Symbol.for('drogonjs:route-args'),
  ROUTE_OPTIONS: Symbol.for('drogonjs:route-options'),
  INJECT_TOKENS: Symbol.for('drogonjs:inject-tokens'),
  OPTIONAL_TOKENS: Symbol.for('drogonjs:optional-tokens'),
  GUARDS: Symbol.for('drogonjs:guards'),
  INTERCEPTORS: Symbol.for('drogonjs:interceptors'),
  PIPES: Symbol.for('drogonjs:pipes'),
  EXCEPTION_FILTERS: Symbol.for('drogonjs:exception-filters'),
  CATCH: Symbol.for('drogonjs:catch'),
  SCOPE: Symbol.for('drogonjs:scope'),
  VERSION: Symbol.for('drogonjs:version'),
  PROPERTY_DEPS: Symbol.for('drogonjs:property-deps'),
  PARAM_TYPES: 'design:paramtypes',
  RETURN_TYPE: 'design:returntype'
} as const;

export type MetadataKey = (typeof METADATA_KEYS)[keyof typeof METADATA_KEYS];
