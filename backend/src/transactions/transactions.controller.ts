import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { AuthRequest } from '../auth/auth.js';
import { TransactionsService } from './transactions.service.js';

@Controller('api/v1/households/:householdId/transactions')
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}
  @Get() list(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Query() query: unknown,
  ) {
    return this.service.list(req.identity, h, query);
  }
  @Get(':id') get(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
  ) {
    return this.service.get(req.identity, h, id);
  }
  @Post() create(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Body() body: unknown,
    @Headers('idempotency-key') key: unknown,
  ) {
    return this.service.create(req.identity, h, body, key);
  }
  @Patch(':id') edit(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.edit(req.identity, h, id, body);
  }
  @Post(':id/void') @HttpCode(200) void(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.void(req.identity, h, id, body);
  }
}
