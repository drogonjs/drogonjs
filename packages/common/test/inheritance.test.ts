import { describe, expect, it } from 'bun:test';
import {
  Controller, Get, Param, Post, getControllerMeta, getRouteParams, getRoutes
} from '../src/index';

@Controller('/base')
class BaseController {
  @Get('/:id')
  find(@Param('id') id: string) {
    return id;
  }

  @Post('/')
  create() {
    return 'created';
  }
}

@Controller('/extended')
class ExtendedController extends BaseController {
  @Get('/own')
  own() {
    return 'own';
  }
}

describe('controller inheritance', () => {
  it('exposes routes declared on a base controller', () => {
    const routes = getRoutes(ExtendedController);
    const paths = routes.map(route => `${route.method} ${route.path}`).sort();

    expect(paths).toEqual(['GET /:id', 'GET /own', 'POST /']);
  });

  it('keeps the base controller usable on its own', () => {
    expect(getRoutes(BaseController)).toHaveLength(2);
    expect(getControllerMeta(ExtendedController).path).toBe('/extended');
  });

  it('keeps parameter metadata for inherited handlers', () => {
    expect(getRouteParams(ExtendedController, 'find')).toMatchObject([
      { index: 0, type: 'param', key: 'id' }
    ]);
  });
});
