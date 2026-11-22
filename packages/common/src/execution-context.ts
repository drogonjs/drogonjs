export interface HttpArgumentsHost {
  getRequest<T = unknown>(): T;
  getResponse<T = unknown>(): T;
  getParams<T = Record<string, string>>(): T;
  getQuery<T = Record<string, string>>(): T;
  getHeaders<T = Record<string, string>>(): T;
  getBody<T = unknown>(): T;
}

/** Only HTTP exists today; the union leaves room for other transports. */
export type ContextType = 'http';

/** What exception filters receive: the arguments of the handler being run. */
export interface ArgumentsHost {
  getType<T extends string = ContextType>(): T;
  switchToHttp(): HttpArgumentsHost;
  getArgs<T extends unknown[] = unknown[]>(): T;
  getArgByIndex<T = unknown>(index: number): T;
}

export interface ExecutionContext extends ArgumentsHost {
  getClass<T = Function>(): T;
  getHandler(): Function;
}

export interface CallHandler<T = unknown> {
  handle(): Promise<T>;
}
