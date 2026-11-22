export const SCHEMATICS = ['module', 'controller', 'service', 'resource', 'guard', 'interceptor', 'pipe', 'filter', 'middleware'] as const;

export type Schematic = (typeof SCHEMATICS)[number];

export interface GeneratedFile {
  path: string;
  content: string;
}

export function isSchematic(value: string): value is Schematic {
  return (SCHEMATICS as readonly string[]).includes(value);
}

function classify(name: string) {
  // The extension is stripped from every segment, not just the last one, so
  // `users.ts` never becomes a directory called `users.ts`.
  const parts = name
    .split(/[\\/]+/)
    .map(part => part.replace(/\.(ts|js)$/, ''))
    .filter(Boolean);
  // Generated files must stay under src/modules.
  if (parts.some(part => part === '.' || part === '..')) {
    throw new Error(`Invalid name "${name}": "." and ".." segments are not allowed`);
  }
  const raw = parts.at(-1) ?? '';
  if (!/^[A-Za-z_$]/.test(raw)) {
    throw new Error(`Invalid name "${name}": it must start with a letter, "_" or "$" to form a class name`);
  }
  const className = raw
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join('');
  return { parts, raw, className };
}

function modulePath(parts: string[]) {
  return ['src', 'modules', ...parts];
}

function renderModule(name: string): GeneratedFile {
  const { parts, raw, className } = classify(name);
  return {
    path: [...modulePath(parts), `${raw}.module.ts`].join('/'),
    content: `import { Module } from '@drogonjs/common';

@Module({})
export class ${className}Module {}
`
  };
}

function renderService(name: string): GeneratedFile {
  const { parts, raw, className } = classify(name);
  return {
    path: [...modulePath(parts), `${raw}.service.ts`].join('/'),
    content: `import { Injectable } from '@drogonjs/common';

@Injectable()
export class ${className}Service {}
`
  };
}

function renderController(name: string): GeneratedFile {
  const { parts, raw, className } = classify(name);
  return {
    path: [...modulePath(parts), `${raw}.controller.ts`].join('/'),
    content: `import { Controller, Get } from '@drogonjs/common';

@Controller('/${raw}')
export class ${className}Controller {
  @Get('/')
  index() {
    return { resource: '${raw}' };
  }
}
`
  };
}

const ENHANCERS = {
  guard: (className: string) => `import { Injectable, type CanActivate, type ExecutionContext } from '@drogonjs/common';

@Injectable()
export class ${className}Guard implements CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> {
    return true;
  }
}
`,
  interceptor: (className: string) => `import { Injectable, type CallHandler, type DrogonInterceptor, type ExecutionContext } from '@drogonjs/common';

@Injectable()
export class ${className}Interceptor implements DrogonInterceptor {
  async intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle();
  }
}
`,
  pipe: (className: string) => `import { Injectable, type ArgumentMetadata, type PipeTransform } from '@drogonjs/common';

@Injectable()
export class ${className}Pipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    return value;
  }
}
`,
  filter: (className: string) => `import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@drogonjs/common';

@Catch(HttpException)
export class ${className}Filter implements ExceptionFilter<HttpException> {
  catch(exception: HttpException, host: ArgumentsHost) {
    return exception.toJSON();
  }
}
`,
  middleware: (className: string) => `import { Injectable, type DrogonMiddleware, type ResponseHandle } from '@drogonjs/common';

@Injectable()
export class ${className}Middleware implements DrogonMiddleware {
  async use(req: Request, res: ResponseHandle, next: () => Promise<void>) {
    await next();
  }
}
`
} satisfies Record<string, (className: string) => string>;

type EnhancerSchematic = keyof typeof ENHANCERS;

function renderEnhancer(kind: EnhancerSchematic, name: string): GeneratedFile {
  const { parts, raw, className } = classify(name);
  return {
    path: [...modulePath(parts), `${raw}.${kind}.ts`].join('/'),
    content: ENHANCERS[kind](className)
  };
}

function renderResource(name: string): GeneratedFile[] {
  const moduleFile = renderModule(name);
  const serviceFile = renderService(name);
  const controllerFile = renderController(name);
  const { className, raw } = classify(name);
  moduleFile.content = `import { Module } from '@drogonjs/common';
import { ${className}Controller } from './${raw}.controller';
import { ${className}Service } from './${raw}.service';

@Module({
  providers: [${className}Service],
  controllers: [${className}Controller]
})
export class ${className}Module {}
`;
  return [moduleFile, serviceFile, controllerFile];
}

export function generateFiles(schematic: Schematic, name: string): GeneratedFile[] {
  switch (schematic) {
    case 'module':
      return [renderModule(name)];
    case 'service':
      return [renderService(name)];
    case 'controller':
      return [renderController(name)];
    case 'resource':
      return renderResource(name);
    case 'guard':
    case 'interceptor':
    case 'pipe':
    case 'filter':
    case 'middleware':
      return [renderEnhancer(schematic, name)];
    default:
      // Reachable from JavaScript callers, where the union is not enforced.
      throw new Error(`Unknown schematic: ${String(schematic)}`);
  }
}
