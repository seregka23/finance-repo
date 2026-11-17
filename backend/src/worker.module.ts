import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ApiErrorFilter } from './auth/api-error.filter.js';
import { AuthService, ApiAuthGuard, AuthController } from './auth/auth.js';
import {
  HouseholdAccessService,
  HouseholdGuard,
  HouseholdsController,
  HouseholdsService,
} from './households/households.js';
import { AppModule } from './app.module.js';
import {
  CategoriesController,
  CategoryService,
} from './categories/categories.js';
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
  ): DynamicModule {
    return {
      module: WorkerModule,
      controllers: [
        AuthController,
        HouseholdsController,
        WorkspaceController,
        CategoriesController,
        ...(probeEnabled ? [InfrastructureProbeController] : []),
      ],
      providers: [
        { provide: DATABASE, useValue: database },
        AuthService,
        HouseholdAccessService,
        HouseholdsService,
        WorkspaceService,
        CategoryService,
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        { provide: APP_GUARD, useClass: ApiAuthGuard },
        { provide: APP_GUARD, useClass: HouseholdGuard },
        ...(probeEnabled ? [InfrastructureProbeService] : []),
      ],
    };
  }
}
