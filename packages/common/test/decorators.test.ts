import { describe, expect, it } from 'bun:test';
import {
  Body, Controller, Detail, Get, getControllerMeta, getRouteParams, getRoutes,
  getControllerEnhancers, Inject, Injectable, isInjectable, Optional, Param, Post,
  UseFilters, UseGuards, UseInterceptors, UsePipes
} from '../src/index';

@Injectable()
class Dep {}

@Injectable()
class Service {
  constructor(@Inject(Dep) public dep: Dep, @Optional() public maybe?: Dep) {}
}

class SomeGuard {}

@Controller('/users')
class UsersController {
  @Get('/:id')
  @UseGuards(SomeGuard)
  @Detail({ summary: 'Find user', tags: ['users'] })
  find(@Param('id') id: string) {
    return id;
  }

  @Post('/')
  @Detail({ summary: 'List users', tags: ['users'] })
  create(@Body() body: unknown) {
    return body;
  }
}

describe('@drogonjs/common decorators', () => {
  it('marks classes injectable', () => {
    expect(isInjectable(Service)).toBe(true);
  });

  it('registers controller metadata', () => {
    expect(getControllerMeta(UsersController).path).toBe('/users');
  });

  it('registers routes with normalized paths', () => {
    const routes = getRoutes(UsersController);
    expect(routes).toHaveLength(2);
    const getRoute = routes.find(r => r.method === 'GET')!;
    expect(getRoute.path).toBe('/:id');
    expect(getRoute.guards).toHaveLength(1);
  });

  it('registers parameter metadata', () => {
    const params = getRouteParams(UsersController, 'find');
    expect(params[0]).toMatchObject({ index: 0, type: 'param', key: 'id' });
  });

  it('registers route detail metadata', () => {
    const routes = getRoutes(UsersController);
    const postRoute = routes.find(r => r.method === 'POST')!;
    expect(postRoute.detail).toEqual({
      summary: 'List users',
      tags: ['users']
    });
  });

  it('splits a param decorator\'s key from its pipes', () => {
    class Pipe {}
    const instance = { transform: (v: unknown) => v };

    class Target {
      handler(@Param('id', Pipe) _id: string, @Body(instance) _body: unknown, @Body() _plain: unknown) {}
    }

    const params = getRouteParams(Target, 'handler');
    expect(params).toHaveLength(3);
    expect(params.find(p => p.index === 0)).toMatchObject({ type: 'param', key: 'id', pipes: [Pipe] });
    expect(params.find(p => p.index === 1)).toMatchObject({ type: 'body', key: undefined, pipes: [instance] });
    expect(params.find(p => p.index === 2)).toMatchObject({ type: 'body', pipes: [] });
  });

  it('collects controller-level enhancers from options and class decorators', () => {
    class OptionGuard {}
    class ClassGuard {}
    class BaseGuard {}
    class Interceptor {}
    class Pipe {}
    class Filter {}

    @UseGuards(BaseGuard)
    class Base {}

    @Controller('/x', { guards: [OptionGuard] })
    @UseGuards(ClassGuard)
    @UseInterceptors(Interceptor)
    @UsePipes(Pipe)
    @UseFilters(Filter)
    class Derived extends Base {}

    expect(getControllerEnhancers(Derived)).toEqual({
      guards: [OptionGuard, BaseGuard, ClassGuard],
      interceptors: [Interceptor],
      pipes: [Pipe],
      filters: [Filter]
    });
  });

  it('records method-level pipes on the route', () => {
    class Pipe {}

    @Controller('/piped')
    class Piped {
      @Post('/')
      @UsePipes(Pipe)
      create() {}
    }

    expect(getRoutes(Piped)[0]!.pipes).toEqual([Pipe]);
  });
});
