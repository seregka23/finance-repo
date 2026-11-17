import { DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ApiErrorFilter } from './auth/api-error.filter.js';
import { AuthService } from './auth/auth.service.js';
import { ApiAuthGuard } from './auth/api-auth.guard.js';
import { AuthController } from './auth/auth.controller.js';
import { HouseholdAccessService } from './households/household-access.service.js';
import { HouseholdGuard } from './households/household.guard.js';
import { HouseholdsController } from './households/households.controller.js';
import { HouseholdsService } from './households/households.service.js';
import { AppModule } from './app.module.js';
import { PrismaService } from './database/prisma.service.js';
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
import { TransactionsController } from './transactions/transactions.controller.js';
import { TransactionsService } from './transactions/transactions.service.js';
import { PostingRepository } from './transactions/posting.repository.js';
import { DATABASE, HealthController } from './health.controller.js';

@Module({
  imports: [AppModule],
  controllers: [HealthController],
})
export class WorkerModule {
  static register(database: D1Database, probeEnabled = false): DynamicModule {
    return {
      module: WorkerModule,
      controllers: [
        AuthController,
        HouseholdsController,
        WorkspaceController,
        CategoriesController,
        TransactionsController,
        ...(probeEnabled ? [InfrastructureProbeController] : []),
      ],
      providers: [
        { provide: DATABASE, useValue: database },
        PrismaService,
        AuthService,
        HouseholdAccessService,
        HouseholdsService,
        WorkspaceService,
        CategoryService,
        TransactionsService,
        PostingRepository,
        { provide: APP_FILTER, useClass: ApiErrorFilter },
        { provide: APP_GUARD, useClass: ApiAuthGuard },
        { provide: APP_GUARD, useClass: HouseholdGuard },
        ...(probeEnabled ? [InfrastructureProbeService] : []),
      ],
    };
  }
}
