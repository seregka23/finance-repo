import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { Identity } from '../auth/auth.types.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { BodyDto } from '../validation/request-dto.js';
import {
  HouseholdDto,
  InviteDto,
  AcceptInvitationDto,
} from './households.dto.js';
import { HouseholdAccessService } from './household-access.service.js';
import { HouseholdsService } from './households.service.js';

@Controller('api/v1')
export class HouseholdsController {
  constructor(
    private readonly service: HouseholdsService,
    private readonly access: HouseholdAccessService,
  ) {}
  @Get('session') session(@CurrentIdentity() identity: Identity) {
    return this.service.session(identity);
  }
  @Post('households') create(
    @CurrentIdentity() identity: Identity,
    @BodyDto(HouseholdDto) body: HouseholdDto,
  ) {
    return this.service.create(identity, body);
  }
  @Get('households/:householdId') get(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') id: string,
  ) {
    return this.access.get(identity, id);
  }
  @Patch('households/:householdId') update(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') id: string,
    @BodyDto(HouseholdDto) body: HouseholdDto,
  ) {
    return this.service.update(identity, id, body);
  }
  @Get('households/:householdId/members') members(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') id: string,
  ) {
    return this.service.members(identity, id);
  }
  @Post('households/:householdId/invitations') invite(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') id: string,
    @BodyDto(InviteDto) body: InviteDto,
  ) {
    return this.service.invite(identity, id, body);
  }
  @Post('invitations/accept') accept(
    @CurrentIdentity() identity: Identity,
    @BodyDto(AcceptInvitationDto) body: AcceptInvitationDto,
  ) {
    return this.service.accept(identity, body);
  }
  @Delete('households/:householdId/invitations/:invitationId')
  @HttpCode(204)
  cancel(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') id: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.service.cancel(identity, id, invitationId);
  }
  @Delete('households/:householdId/members/:memberId') @HttpCode(204) revoke(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.service.revoke(identity, id, memberId);
  }
}
