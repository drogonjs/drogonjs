import { describe, expect, it } from 'bun:test';
import { Body, Controller, HttpCode, Get, Module, NotFoundException, Post } from '@drogonjs/common';
import { createElysiaApplication } from '../src/index';

@Controller('/things')
class ThingsController {
  @Post('/')
  @HttpCode(201)
  create(@Body() body: Record<string, unknown>) {
    return body;
  }

  @Get('/missing')
  missing() {
    throw new NotFoundException('no such thing');
  }
}

@Module({ controllers: [ThingsController] })
class AppModule {}

const { app } = await createElysiaApplication(AppModule);

describe('@drogonjs/platform-elysia responses', () => {
  it('honours @HttpCode', async () => {
    const response = await app.handle(new Request('http://localhost/things', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'amir' })
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ name: 'amir' });
  });

  it('maps HttpException to its status and payload', async () => {
    const response = await app.handle(new Request('http://localhost/things/missing'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ statusCode: 404, message: 'no such thing' });
  });
});
