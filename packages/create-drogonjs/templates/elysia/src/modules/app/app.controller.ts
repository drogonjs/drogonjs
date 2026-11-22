// #if openapi
import { Controller, Detail, Get, Param } from '@drogonjs/common';
// #endif
// #if !openapi
import { Controller, Get, Param } from '@drogonjs/common';
// #endif
import { AppService } from './app.service';

@Controller('/')
export class AppController {
  // Constructor parameters are resolved from the module's providers.
  constructor(private readonly app: AppService) {}

  @Get('/')
  // #if openapi
  @Detail({ summary: 'Service status', tags: ['app'] })
  // #endif
  index() {
    return this.app.info();
  }

  @Get('/hello/:name')
  // #if openapi
  @Detail({ summary: 'Greet someone by name', tags: ['app'] })
  // #endif
  hello(@Param('name') name: string) {
    return this.app.greet(name);
  }
}
