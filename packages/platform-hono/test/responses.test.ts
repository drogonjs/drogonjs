import { describe, expect, it } from 'bun:test';
import {
  Body, Controller, Get, HttpCode, Module, NotFoundException, Param, Post
} from '@drogonjs/common';
import { createHonoApplication } from '../src/index';

@Controller('/things')
class ThingsController {
  @Get('/:id')
  find(@Param('id') id: string) {
    return { id };
  }

  @Post('/')
  @HttpCode(201)
  create(@Body() body: Record<string, unknown>) {
    return body;
  }

  @Get('/missing/one')
  missing() {
    throw new NotFoundException('no such thing');
  }

  @Get('/empty/one')
  empty() {
    return undefined;
  }

  @Get('/text/one')
  text() {
    return 'plain text';
  }

  @Get('/raw/one')
  raw() {
    return new Response('raw', { status: 418 });
  }
}

@Module({ controllers: [ThingsController] })
class AppModule {}

const { app } = await createHonoApplication(AppModule);

describe('@drogonjs/platform-hono responses', () => {
  it('honours @HttpCode', async () => {
    const response = await app.request('/things', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'amir' })
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ name: 'amir' });
  });

  it('maps HttpException to its status and payload', async () => {
    const response = await app.request('/things/missing/one');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ statusCode: 404, message: 'no such thing' });
  });

  it('returns 204 for an empty result', async () => {
    const response = await app.request('/things/empty/one');
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });

  it('returns a string result as text rather than JSON', async () => {
    const response = await app.request('/things/text/one');
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(await response.text()).toBe('plain text');
  });

  it('passes a Response through untouched', async () => {
    const response = await app.request('/things/raw/one');
    expect(response.status).toBe(418);
    expect(await response.text()).toBe('raw');
  });

  it('answers a malformed json body with 400', async () => {
    const response = await app.request('/things', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{ not json'
    });
    expect(response.status).toBe(400);
  });
});
