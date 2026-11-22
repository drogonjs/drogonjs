import { describe, expect, it } from 'bun:test';
import { Controller, Detail, Get } from '@drogonjs/common';
import { collectOpenAPIOperations, createOpenAPIDocument } from '../src/index';

@Controller('/users')
class UsersController {
  @Get('/')
  @Detail({
    summary: 'List users',
    tags: ['users']
  })
  index() {
    return [];
  }
}

describe('@drogonjs/openapi', () => {
  it('collects route detail metadata into paths', () => {
    const spec = collectOpenAPIOperations([UsersController]);

    expect(spec.paths['/users']).toBeDefined();
    expect(spec.paths['/users']!.get).toBeDefined();
    expect(spec.paths['/users']!.get!.summary).toBe('List users');
    expect(spec.paths['/users']!.get!.tags).toEqual(['users']);
    expect(spec.paths['/users']!.get!.responses).toEqual({
      '200': {
        description: 'Successful response'
      }
    });
  });

  it('creates an OpenAPI document with inferred tags', () => {
    const doc = createOpenAPIDocument([UsersController], {
      documentation: {
        info: {
          title: 'Test API',
          version: '0.1.0'
        }
      }
    });

    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info.title).toBe('Test API');
    expect(doc.info.version).toBe('0.1.0');
    expect(doc.paths['/users']).toBeDefined();
    expect(doc.paths['/users']!.get).toBeDefined();
    expect(doc.paths['/users']!.get!.summary).toBe('List users');
    expect(doc.paths['/users']!.get!.tags).toEqual(['users']);
    expect(doc.tags).toEqual([{ name: 'users' }]);
  });

  it('keeps the default info fields the caller did not supply', () => {
    const doc = createOpenAPIDocument([UsersController], {
      documentation: { info: { title: 'Only Title' } as never }
    });

    // `version` is required by the spec, so the default has to survive a
    // partial `info`.
    expect(doc.info.title).toBe('Only Title');
    expect(doc.info.version).toBe('1.0.0');
    expect(doc.openapi).toBe('3.0.3');
  });

  it('keeps manually declared paths alongside collected ones', () => {
    const doc = createOpenAPIDocument([UsersController], {
      documentation: { paths: { '/manual': {} } } as never
    });

    expect(Object.keys(doc.paths).sort()).toEqual(['/manual', '/users']);
  });

  it('lets the caller pin the openapi version', () => {
    const doc = createOpenAPIDocument([UsersController], {
      documentation: { openapi: '3.1.0' } as never
    });

    expect(doc.openapi).toBe('3.1.0');
  });
});
