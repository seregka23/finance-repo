import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.types.js';
import { HouseholdAccessService } from './household-access.service.js';
import { HouseholdsService } from './households.service.js';

@Controller('api/v1')
export class HouseholdsController {
  constructor(
    private readonly service: HouseholdsService,
    private readonly access: HouseholdAccessService,
  ) {}
  @Get('session') session(@Req() req: AuthRequest) {
    return this.service.session(req.identity);
  }
  @Post('households') create(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.create(req.identity, body);
  }
  @Get('households/:householdId') get(
    @Req() req: AuthRequest,
    @Param('householdId') id: string,
  ) {
    return this.access.get(req.identity, id);
  }
  @Patch('households/:householdId') update(
    @Req() req: AuthRequest,
    @Param('householdId') id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(req.identity, id, body);
  }
  @Get('households/:householdId/members') members(
    @Req() req: AuthRequest,
    @Param('householdId') id: string,
  ) {
    return this.service.members(req.identity, id);
  }
  @Post('households/:householdId/invitations') invite(
    @Req() req: AuthRequest,
    @Param('householdId') id: string,
    @Body() body: unknown,
  ) {
    return this.service.invite(req.identity, id, body);
  }
  @Post('invitations/accept') accept(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.service.accept(req.identity, body);
  }
  @Delete('households/:householdId/invitations/:invitationId')
  @HttpCode(204)
  cancel(
    @Req() req: AuthRequest,
    @Param('householdId') id: string,
    @Param('invitationId') invitationId: string,
  ) {
    return this.service.cancel(req.identity, id, invitationId);
  }
  @Delete('households/:householdId/members/:memberId') @HttpCode(204) revoke(
    @Req() req: AuthRequest,
    @Param('householdId') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.service.revoke(req.identity, id, memberId);
  }
}
