import { describe, expect, it } from 'bun:test';
import { Body, Controller, Get, Module, Param, Post } from '@drogonjs/common';
import { createHonoApplication } from '../src/index';

@Controller('/users')
class UsersController {
  @Get('/:id')
  find(@Param('id') id: string) {
    return { id };
  }

  @Post('/')
  create(@Body() body: Record<string, unknown>) {
    return body;
  }
}

@Module({
  controllers: [UsersController]
})
class AppModule {}

describe('@drogonjs/platform-hono', () => {
  it('mounts controller routes into a Hono app', async () => {
    const { app } = await createHonoApplication(AppModule);
    const response = await app.request('/users/42');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: '42' });
  });

  it('binds json body parameters for post handlers', async () => {
    const { app } = await createHonoApplication(AppModule);
    const response = await app.request('/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'amir' })
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'amir' });
  });
});
