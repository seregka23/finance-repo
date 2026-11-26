import { Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import type { Identity } from '../auth/auth.types.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { BodyDto, QueryDto } from '../validation/request-dto.js';
import {
  AccountListQueryDto,
  CreateAccountDto,
  UpdateAccountDto,
  AccountVersionDto,
  AccountAdjustmentDto,
  MovementQueryDto,
} from './accounts.dto.js';
import { AccountsService } from './accounts.service.js';

@Controller('api/v1/households/:householdId/accounts')
export class AccountsController {
  constructor(private readonly service: AccountsService) {}
  @Get() list(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @QueryDto(AccountListQueryDto) query: AccountListQueryDto,
  ) {
    return this.service.list(identity, h, query);
  }
  @Post() create(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @BodyDto(CreateAccountDto) body: CreateAccountDto,
  ) {
    return this.service.create(identity, h, body);
  }
  @Get(':id') get(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Param('id') id: string,
  ) {
    return this.service.get(identity, h, id);
  }
  @Patch(':id') update(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @BodyDto(UpdateAccountDto) body: UpdateAccountDto,
  ) {
    return this.service.update(identity, h, id, body);
  }
  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @BodyDto(AccountVersionDto) body: AccountVersionDto,
  ) {
    return this.service.setStatus(identity, h, id, 'archived', body);
  }
  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @BodyDto(AccountVersionDto) body: AccountVersionDto,
  ) {
    return this.service.setStatus(identity, h, id, 'active', body);
  }
  @Post(':id/adjustments')
  adjust(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @BodyDto(AccountAdjustmentDto) body: AccountAdjustmentDto,
  ) {
    return this.service.adjust(identity, h, id, body);
  }
  @Get(':id/movements')
  movements(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @QueryDto(MovementQueryDto) query: MovementQueryDto,
  ) {
    return this.service.movements(identity, h, id, query);
  }
}
