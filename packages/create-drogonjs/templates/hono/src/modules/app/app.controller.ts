import { Controller, Get, Param } from '@drogonjs/common';
import { AppService } from './app.service';

@Controller('/')
export class AppController {
  // Constructor parameters are resolved from the module's providers.
  constructor(private readonly app: AppService) {}

  @Get('/')
  index() {
    return this.app.info();
  }

  @Get('/hello/:name')
  hello(@Param('name') name: string) {
    return this.app.greet(name);
  }
}
