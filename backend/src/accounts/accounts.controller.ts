import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.types.js';
import { AccountsService } from './accounts.service.js';

@Controller('api/v1/households/:householdId/accounts')
export class AccountsController {
  constructor(private readonly service: AccountsService) {}
  @Get() list(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Query() query: unknown,
  ) {
    return this.service.list(req.identity, h, query);
  }
  @Post() create(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Body() body: unknown,
  ) {
    return this.service.create(req.identity, h, body);
  }
  @Get(':id') get(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
  ) {
    return this.service.get(req.identity, h, id);
  }
  @Patch(':id') update(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.update(req.identity, h, id, body);
  }
  @Post(':id/archive')
  @HttpCode(200)
  archive(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.setStatus(req.identity, h, id, 'archived', body);
  }
  @Post(':id/restore')
  @HttpCode(200)
  restore(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.setStatus(req.identity, h, id, 'active', body);
  }
  @Post(':id/adjustments')
  adjust(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.adjust(req.identity, h, id, body);
  }
  @Get(':id/movements')
  movements(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Query() query: unknown,
  ) {
    return this.service.movements(req.identity, h, id, query);
  }
}
