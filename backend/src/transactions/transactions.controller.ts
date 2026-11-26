import type {
  CreateTransactionDto,
  EditTransactionDto,
} from './transactions.dto.js';
import {
  TransactionListQueryDto,
  TransactionExportQueryDto,
  TransactionVersionDto,
} from './transactions.dto.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
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
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Identity } from '../auth/auth.js';
import { TransactionsService } from './transactions.service.js';

@Controller('api/v1/households/:householdId/transactions')
export class TransactionsController {
  constructor(private readonly service: TransactionsService) {}
  @Get() list(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Query() query: TransactionListQueryDto,
  ) {
    return this.service.list(identity, h, query);
  }
  @Get('export') async exportCsv(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Query() query: TransactionExportQueryDto,
    @Res() res: Response,
  ) {
    const csv = await this.service.exportCsv(identity, h, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="transactions.csv"',
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(csv);
  }
  @Get(':id') get(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Param('id') id: string,
  ) {
    return this.service.get(identity, h, id);
  }
  @Post() create(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Body() body: CreateTransactionDto,
    @Headers('idempotency-key') key: string | string[] | undefined,
  ) {
    return this.service.create(identity, h, body, key);
  }
  @Patch(':id') edit(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Body() body: EditTransactionDto,
  ) {
    return this.service.edit(identity, h, id, body);
  }
  @Post(':id/void') @HttpCode(200) void(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @Body() body: TransactionVersionDto,
  ) {
    return this.service.void(identity, h, id, body);
  }
}
