import { DynamicModule, Module } from '@nestjs/common';
import { AppModule } from './app.module.js';
import {
  DATABASE,
  HealthController,
  HealthDatabase,
} from './health.controller.js';

@Module({
  imports: [AppModule],
  controllers: [HealthController],
})
export class WorkerModule {
  static register(database: HealthDatabase): DynamicModule {
    return {
      module: WorkerModule,
      providers: [{ provide: DATABASE, useValue: database }],
    };
  }
}
