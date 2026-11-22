import type { ExecutionContext } from './execution-context';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ALL';

/** Enum spelling of {@link HttpMethod}; the values are the same strings. */
export enum RequestMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  PATCH = 'PATCH',
  DELETE = 'DELETE',
  OPTIONS = 'OPTIONS',
  HEAD = 'HEAD',
  ALL = 'ALL'
}

export type ParamType =
  | 'ctx'
  | 'req'
  | 'res'
  | 'body'
  | 'query'
  | 'param'
  | 'params'
  | 'headers'
  | 'cookie'
  | 'ip'
  | 'custom';

export type CustomParamFactory<TData = any, TResult = any> = (
  data: TData,
  context: ExecutionContext
) => TResult | Promise<TResult>;

export interface ParamDefinition {
  index: number;
  type: ParamType;
  key?: string;
  pipes?: unknown[];
  /** Set for parameters declared through `createParamDecorator`. */
  factory?: CustomParamFactory;
  /** The argument given to a custom parameter decorator. */
  data?: unknown;
}

/** Matches every version, including requests that name none. */
export const VERSION_NEUTRAL: unique symbol = Symbol.for('drogonjs:VERSION_NEUTRAL') as never;

export type VersionValue = string | typeof VERSION_NEUTRAL | Array<string | typeof VERSION_NEUTRAL>;

export interface RedirectOptions {
  url: string;
  statusCode: number;
}

export interface RouteOptions {
  guards?: unknown[];
  interceptors?: unknown[];
  pipes?: unknown[];
  filters?: unknown[];
  schema?: Record<string, unknown>;
  statusCode?: number;
  detail?: Record<string, unknown>;
  headers?: Record<string, string>;
  redirect?: RedirectOptions;
  version?: VersionValue;
}

export interface RouteDefinition extends RouteOptions {
  method: HttpMethod;
  path: string;
  propertyKey: string | symbol;
}

export interface ControllerOptions {
  path?: string;
  version?: VersionValue;
  guards?: unknown[];
  interceptors?: unknown[];
  pipes?: unknown[];
  filters?: unknown[];
}

export enum VersioningType {
  URI = 'uri',
  HEADER = 'header',
  MEDIA_TYPE = 'media-type',
  CUSTOM = 'custom'
}

interface VersioningCommonOptions {
  /** The version of routes and controllers that declare none. */
  defaultVersion?: VersionValue;
}

export interface UriVersioningOptions extends VersioningCommonOptions {
  type: VersioningType.URI;
  /** Put before the version in the path. Defaults to `'v'`; `false` for none. */
  prefix?: string | false;
}

export interface HeaderVersioningOptions extends VersioningCommonOptions {
  type: VersioningType.HEADER;
  header: string;
}

export interface MediaTypeVersioningOptions extends VersioningCommonOptions {
  type: VersioningType.MEDIA_TYPE;
  /** The parameter of the `Accept` header holding the version, e.g. `'v='`. */
  key: string;
}

export interface CustomVersioningOptions extends VersioningCommonOptions {
  type: VersioningType.CUSTOM;
  /** The requested versions, most preferred first. */
  extractor: (request: Request) => string | string[] | undefined;
}

export type VersioningOptions =
  | UriVersioningOptions
  | HeaderVersioningOptions
  | MediaTypeVersioningOptions
  | CustomVersioningOptions;
