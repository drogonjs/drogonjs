export enum Scope {
  DEFAULT = 'singleton',
  TRANSIENT = 'transient',
  REQUEST = 'request'
}

export interface ScopeOptions {
  scope?: Scope;
}
