import {
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Req,
} from '@nestjs/common';
import type { AuthRequest, Identity } from '../auth/auth.js';
import { DATABASE } from '../health.controller.js';
import {
  HouseholdAccessService,
  type Database,
} from '../households/households.js';

interface WorkspaceCounts {
  accounts: number;
  transactions: number;
  plans: number;
  reserves: number;
  accountMovements: number;
}

@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: HouseholdAccessService,
  ) {}

  async get(identity: Identity, householdId: string) {
    const [, result] = await this.access.batch(
      identity,
      householdId,
      'member',
      [
        this.db
          .prepare(
            `SELECT
        (SELECT COUNT(*) FROM accounts WHERE household_id=?) AS accounts,
        (SELECT COUNT(*) FROM transactions WHERE household_id=?) AS transactions,
        (SELECT COUNT(*) FROM monthly_plans WHERE household_id=?) AS plans,
        (SELECT COUNT(*) FROM reserves WHERE household_id=?) AS reserves,
        (SELECT COUNT(*) FROM account_movements WHERE household_id=?) AS accountMovements`,
          )
          .bind(
            householdId,
            householdId,
            householdId,
            householdId,
            householdId,
          ),
      ],
    );
    return {
      counts: result.results[0] as WorkspaceCounts,
      capabilities: {
        accounts: true,
        transactions: true,
        imports: false,
        budgets: true,
        reserves: true,
        reports: true,
      },
    };
  }
}

@Controller('api/v1/households/:householdId/workspace')
export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}

  @Get()
  get(@Req() req: AuthRequest, @Param('householdId') householdId: string) {
    return this.service.get(req.identity, householdId);
  }
}
