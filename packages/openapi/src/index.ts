import { openapi } from '@elysia/openapi';
import type { OpenAPIV3 } from 'openapi-types';
import {
  getControllerMeta,
  getRoutes,
  type Constructor
} from '@drogonjs/common';

export interface DrogonOpenAPIOptions {
  documentation?: Partial<OpenAPIV3.Document>;
  path?: string;
  excludeMethods?: string[];
}

type PathMethod =
  | 'get'
  | 'post'
  | 'put'
  | 'patch'
  | 'delete'
  | 'options'
  | 'head'
  | 'trace';

function normalizePath(path: string) {
  if (!path) return '/';
  const withLeadingSlash = path.startsWith('/') ? path : `/${path}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, '/');
  return collapsed.length > 1 && collapsed.endsWith('/')
    ? collapsed.slice(0, -1)
    : collapsed;
}

function joinPaths(...parts: Array<string | undefined>) {
  const filtered = parts.filter(Boolean) as string[];

  if (!filtered.length) return '/';

  const joined = filtered
    .map((part, index) => {
      if (index === 0) return normalizePath(part);
      return part.replace(/^\/+/, '').replace(/\/+$/, '');
    })
    .join('/');

  return normalizePath(joined);
}

function toMethodKey(method: string): PathMethod | null {
  const normalized = method.toLowerCase();

  switch (normalized) {
    case 'get':
    case 'post':
    case 'put':
    case 'patch':
    case 'delete':
    case 'options':
    case 'head':
    case 'trace':
      return normalized;
    default:
      return null;
  }
}

function mergeTags(
  explicit: OpenAPIV3.TagObject[] = [],
  inferred: OpenAPIV3.TagObject[] = []
) {
  const map = new Map<string, OpenAPIV3.TagObject>();

  for (const tag of explicit) {
    map.set(tag.name, tag);
  }

  for (const tag of inferred) {
    if (!map.has(tag.name)) {
      map.set(tag.name, tag);
    }
  }

  return Array.from(map.values());
}

function getRouteDetail(
  route: { detail?: Record<string, unknown> }
): Partial<OpenAPIV3.OperationObject> {
  return (route.detail ?? {}) as Partial<OpenAPIV3.OperationObject>;
}

export function collectOpenAPIOperations(controllers: Constructor[]) {
  const paths: Record<string, OpenAPIV3.PathItemObject> = {};
  const tagMap = new Map<string, OpenAPIV3.TagObject>();

  for (const controller of controllers) {
    const controllerMeta = getControllerMeta(controller);
    const routes = getRoutes(controller) as Array<{
      method: string;
      path: string;
      statusCode?: number;
      detail?: Record<string, unknown>;
    }>;

    for (const route of routes) {
      const fullPath = joinPaths(controllerMeta?.path, route.path);
      const method = toMethodKey(route.method ?? '');

      if (!method) continue;

      const detail = getRouteDetail(route);
      // A route carrying @HttpCode documents that status rather than a 200.
      const successStatus = String(route.statusCode ?? 200);

      const operation: OpenAPIV3.OperationObject = {
        ...detail,
        responses: detail.responses ?? {
          [successStatus]: {
            description: 'Successful response'
          }
        }
      };

      if (!paths[fullPath]) {
        paths[fullPath] = {};
      }

      (paths[fullPath] as Record<string, OpenAPIV3.OperationObject>)[method] = operation;

      for (const tagName of operation.tags ?? []) {
        if (!tagMap.has(tagName)) {
          tagMap.set(tagName, { name: tagName });
        }
      }
    }
  }

  return {
    paths,
    tags: Array.from(tagMap.values())
  };
}

export function createOpenAPIDocument(
  controllers: Constructor[],
  options: DrogonOpenAPIOptions = {}
): OpenAPIV3.Document {
  const collected = collectOpenAPIOperations(controllers);
  const documentation = options.documentation ?? {};
  const explicitTags = (documentation.tags ?? []) as OpenAPIV3.TagObject[];

  // `documentation` is spread first so the merged `info`, `paths` and `tags`
  // below are not overwritten by its partial counterparts. `info.version` is
  // required by the spec, so losing the default produces an invalid document.
  return {
    ...documentation,
    openapi: documentation.openapi ?? '3.0.3',
    info: {
      title: 'DrogonJS API',
      version: '1.0.0',
      ...(documentation.info ?? {})
    },
    paths: {
      ...(documentation.paths ?? {}),
      ...collected.paths
    },
    tags: mergeTags(explicitTags, collected.tags)
  };
}

export function drogonOpenAPI(options: DrogonOpenAPIOptions = {}) {
  return openapi({
    path: options.path ?? '/openapi',
    documentation: options.documentation,
    exclude: options.excludeMethods
      ? { methods: options.excludeMethods }
      : undefined
  } as never);
}
