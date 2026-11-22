export type LogLevel = 'verbose' | 'debug' | 'log' | 'warn' | 'error' | 'fatal';

const LEVEL_ORDER: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];

export interface LoggerService {
  log(message: unknown, ...optionalParams: unknown[]): unknown;
  error(message: unknown, ...optionalParams: unknown[]): unknown;
  warn(message: unknown, ...optionalParams: unknown[]): unknown;
  debug?(message: unknown, ...optionalParams: unknown[]): unknown;
  verbose?(message: unknown, ...optionalParams: unknown[]): unknown;
  fatal?(message: unknown, ...optionalParams: unknown[]): unknown;
  setLogLevels?(levels: LogLevel[]): unknown;
}

export interface ConsoleLoggerOptions {
  logLevels?: LogLevel[];
  timestamp?: boolean;
  prefix?: string;
  colors?: boolean;
  /** One JSON object per line instead of the human-readable format. */
  json?: boolean;
}

const COLORS: Record<LogLevel, string> = {
  verbose: '\x1b[36m',
  debug: '\x1b[35m',
  log: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  fatal: '\x1b[1;31m'
};

/** The default logger: one line per message on stdout, errors and warnings on stderr. */
export class ConsoleLogger implements LoggerService {
  private logLevels: LogLevel[];
  private lastTimestamp?: number;

  constructor(
    protected context?: string,
    protected readonly options: ConsoleLoggerOptions = {}
  ) {
    this.logLevels = options.logLevels ?? [...LEVEL_ORDER];
  }

  setContext(context: string) {
    this.context = context;
  }

  setLogLevels(levels: LogLevel[]) {
    this.logLevels = levels;
  }

  isLevelEnabled(level: LogLevel) {
    return this.logLevels.includes(level);
  }

  log(message: unknown, ...params: unknown[]) {
    this.print('log', message, params);
  }

  error(message: unknown, ...params: unknown[]) {
    this.print('error', message, params);
  }

  warn(message: unknown, ...params: unknown[]) {
    this.print('warn', message, params);
  }

  debug(message: unknown, ...params: unknown[]) {
    this.print('debug', message, params);
  }

  verbose(message: unknown, ...params: unknown[]) {
    this.print('verbose', message, params);
  }

  fatal(message: unknown, ...params: unknown[]) {
    this.print('fatal', message, params);
  }

  protected print(level: LogLevel, message: unknown, params: unknown[]) {
    if (!this.isLevelEnabled(level)) return;
    // A trailing string is the context, as in `logger.log('ready', 'Bootstrap')`.
    let context = this.context;
    if (params.length && typeof params.at(-1) === 'string') context = params.pop() as string;
    const stream = level === 'error' || level === 'fatal' || level === 'warn' ? console.error : console.log;

    if (this.options.json) {
      stream(JSON.stringify({ level, pid: pid(), timestamp: Date.now(), context, message: serialize(message), extra: params.length ? params.map(serialize) : undefined }));
      return;
    }

    const colors = this.options.colors ?? !process?.env?.NO_COLOR;
    const paint = (text: string) => (colors ? `${COLORS[level]}${text}\x1b[0m` : text);
    const now = Date.now();
    const elapsed = this.options.timestamp && this.lastTimestamp !== undefined ? ` +${now - this.lastTimestamp}ms` : '';
    this.lastTimestamp = now;
    const prefix = paint(`[${this.options.prefix ?? 'Drogon'}] ${pid()}  -`);
    const time = new Date(now).toLocaleString();
    const label = paint(level.toUpperCase().padStart(7));
    const ctx = context ? (colors ? ` \x1b[33m[${context}]\x1b[0m` : ` [${context}]`) : '';
    const body = typeof message === 'string' ? paint(message) : serialize(message);
    stream(`${prefix} ${time} ${label}${ctx} ${body}${elapsed}`, ...params);
  }
}

function pid() {
  return typeof process !== 'undefined' ? process.pid : 0;
}

function serialize(value: unknown) {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * `new Logger('UsersService')` for a contextual logger, or the static methods.
 * Every instance writes through the shared logger, which `Logger.overrideLogger`
 * replaces, silences (`false`) or restricts to some levels.
 */
export class Logger implements LoggerService {
  private static instance: LoggerService | false = new ConsoleLogger();

  constructor(
    protected readonly context?: string,
    protected readonly options: { timestamp?: boolean } = {}
  ) {}

  static overrideLogger(logger: LoggerService | LogLevel[] | boolean) {
    if (Array.isArray(logger)) {
      const current = Logger.instance || new ConsoleLogger();
      current.setLogLevels?.(logger);
      Logger.instance = current;
      return;
    }
    if (logger === true) {
      Logger.instance = new ConsoleLogger();
      return;
    }
    Logger.instance = logger;
  }

  static log(message: unknown, ...params: unknown[]) {
    Logger.call('log', message, params);
  }

  static error(message: unknown, ...params: unknown[]) {
    Logger.call('error', message, params);
  }

  static warn(message: unknown, ...params: unknown[]) {
    Logger.call('warn', message, params);
  }

  static debug(message: unknown, ...params: unknown[]) {
    Logger.call('debug', message, params);
  }

  static verbose(message: unknown, ...params: unknown[]) {
    Logger.call('verbose', message, params);
  }

  static fatal(message: unknown, ...params: unknown[]) {
    Logger.call('fatal', message, params);
  }

  log(message: unknown, ...params: unknown[]) {
    Logger.call('log', message, this.withContext(params));
  }

  error(message: unknown, ...params: unknown[]) {
    Logger.call('error', message, this.withContext(params));
  }

  warn(message: unknown, ...params: unknown[]) {
    Logger.call('warn', message, this.withContext(params));
  }

  debug(message: unknown, ...params: unknown[]) {
    Logger.call('debug', message, this.withContext(params));
  }

  verbose(message: unknown, ...params: unknown[]) {
    Logger.call('verbose', message, this.withContext(params));
  }

  fatal(message: unknown, ...params: unknown[]) {
    Logger.call('fatal', message, this.withContext(params));
  }

  private withContext(params: unknown[]) {
    return this.context && !(params.length && typeof params.at(-1) === 'string') ? [...params, this.context] : params;
  }

  private static call(level: LogLevel, message: unknown, params: unknown[]) {
    const target = Logger.instance;
    if (!target) return;
    const fn = target[level] ?? target.log;
    fn.call(target, message, ...params);
  }
}
