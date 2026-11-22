import type { ArgumentsHost, CallHandler, ExecutionContext } from './execution-context';

export interface CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean>;
}

export interface DrogonInterceptor<T = unknown, R = unknown> {
  intercept(context: ExecutionContext, next: CallHandler<T>): Promise<R> | R;
}

export interface PipeTransform<T = unknown, R = unknown> {
  transform(value: T, metadata: ArgumentMetadata): R | Promise<R>;
}

export interface ArgumentMetadata {
  type: 'body' | 'query' | 'param' | 'custom';
  metatype?: new (...args: any[]) => unknown;
  data?: string;
}

export interface ExceptionFilter<T = unknown> {
  catch(exception: T, host: ArgumentsHost): unknown | Promise<unknown>;
}

export interface OnModuleInit {
  onModuleInit(): void | Promise<void>;
}

export interface OnModuleDestroy {
  onModuleDestroy(): void | Promise<void>;
}

export interface OnApplicationBootstrap {
  onApplicationBootstrap(): void | Promise<void>;
}

export interface BeforeApplicationShutdown {
  beforeApplicationShutdown(signal?: string): void | Promise<void>;
}

export interface OnApplicationShutdown {
  onApplicationShutdown(signal?: string): void | Promise<void>;
}

/**
 * Injected by `@Res()`. The same calls work on every adapter; reach for `@Ctx()`
 * when the platform's native context is needed.
 */
export interface ResponseHandle {
  /** Sets the response status, taking precedence over `@HttpCode`. */
  status(code: number): this;
  header(name: string, value: string): this;
}
