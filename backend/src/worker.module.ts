import { DynamicModule, Module } from '@nestjs/common';
import { AppModule } from './app.module.js';
import {
  InfrastructureProbeController,
  InfrastructureProbeService,
} from './infrastructure-probe.controller.js';
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
  static register(
    database: HealthDatabase,
    probeEnabled = false,
  ): DynamicModule {
    return {
      module: WorkerModule,
      controllers: probeEnabled ? [InfrastructureProbeController] : [],
      providers: [
        { provide: DATABASE, useValue: database },
        ...(probeEnabled ? [InfrastructureProbeService] : []),
      ],
    };
  }
}
