import { Module } from '@drogonjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  controllers: [AppController],
  providers: [AppService]
})
export class AppModule {}
