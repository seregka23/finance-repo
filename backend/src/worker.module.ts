import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ApiErrorFilter } from './auth/api-error.filter.js';
import {
  AUTH_CONFIG,
  AccessAuthService,
  ApiAuthGuard,
  AuthController,
  type AuthConfig,
} from './auth/auth.js';
import {
  HouseholdAccessService,
  HouseholdGuard,
  HouseholdsController,
  HouseholdsService,
} from './households/households.js';
import { AppModule } from './app.module.js';
import {
  WorkspaceController,
  WorkspaceService,
} from './workspace/workspace.js';
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
    authConfig: AuthConfig = {},
  ): DynamicModule {
    return {
      module: WorkerModule,
      controllers: [
        AuthController,
        HouseholdsController,
        WorkspaceController,
        ...(probeEnabled ? [InfrastructureProbeController] : []),
      ],
      providers: [
        { provide: DATABASE, useValue: database },
        { provide: AUTH_CONFIG, useValue: authConfig },
        AccessAuthService,
        HouseholdAccessService,
        HouseholdsService,
        WorkspaceService,
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        { provide: APP_GUARD, useClass: ApiAuthGuard },
        { provide: APP_GUARD, useClass: HouseholdGuard },
        ...(probeEnabled ? [InfrastructureProbeService] : []),
      ],
    };
  }
}
