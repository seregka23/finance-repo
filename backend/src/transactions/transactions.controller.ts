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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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
  @Get('export') async exportCsv(
    @Req() req: AuthRequest,
    @Param('householdId') h: string,
    @Query() query: unknown,
    @Res() res: Response,
  ) {
    const csv = await this.service.exportCsv(req.identity, h, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="transactions.csv"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
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
