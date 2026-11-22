import { describe, expect, it } from 'bun:test';
import { Controller, Get, Module, Param, Post, Body } from '@drogonjs/common';
import { createElysiaApplication } from '../src/index';

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

describe('@drogonjs/platform-elysia', () => {
  it('mounts controller routes into an Elysia app', async () => {
    const { app } = await createElysiaApplication(AppModule);
    const response = await app.handle(new Request('http://localhost/users/42'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: '42' });
  });

  it('binds body parameters for post handlers', async () => {
    const { app } = await createElysiaApplication(AppModule);
    const response = await app.handle(new Request('http://localhost/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'amir' })
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'amir' });
  });
});
