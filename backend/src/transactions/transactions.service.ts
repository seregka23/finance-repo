import { validateRequest } from '../validation/request-dto.js';
import {
  PostingDto,
  TransferDto,
  RefundDto,
  EditPostingDto,
  EditTransferDto,
  EditRefundDto,
  ReserveFundingDto,
  TransferFeeDto,
  TransactionVersionDto,
  TransactionExportQueryDto,
  TransactionListQueryDto,
  TransactionCursorDto,
} from './transactions.dto.js';
import { Injectable } from '@nestjs/common';
import { apiError } from '../auth/auth.js';
import type { Identity } from '../auth/auth.js';
import { validateDate } from '../finance/calendar.js';
import { recordConversion } from '../finance/fx.js';
import { parseMinor, validateCurrency } from '../finance/money.js';
import type {
  PostingInput,
  PostingHook,
  TransferInput,
  RefundInput,
  TransactionListOptions,
} from './contracts.js';
import { PostingRepository } from './posting.repository.js';
import { CSV_HEADER, csvRow } from './csv-export.js';

const invalid = () => apiError(400, 'INVALID_INPUT', 'Invalid input');
const inputKeys = [
  'type',
  'transactionDate',
  'accountId',
  'categoryId',
  'amountMinor',
  'currency',
  'exchangeRate',
  'exchangeRateSource',
  'merchant',
  'note',
  'reserveFunding',
];
function requiredText(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    throw invalid();
  return value.trim();
}
function optionalText(value: unknown, max: number): string | null {
  if (value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return requiredText(value, max);
}
function version(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw invalid();
  return value;
}
function posting(
  body: Record<string, unknown>,
  replacement = false,
): PostingInput {
  const required = replacement
    ? inputKeys.filter((key) => key !== 'reserveFunding')
    : inputKeys.filter(
        (key) =>
          ![
            'exchangeRate',
            'exchangeRateSource',
            'merchant',
            'note',
            'reserveFunding',
          ].includes(key),
      );
  if (required.some((key) => !(key in body))) throw invalid();
  if (body.type !== 'expense' && body.type !== 'income') throw invalid();
  try {
    const currency = validateCurrency(body.currency);
    const amount = parseMinor(body.amountMinor);
    if (amount <= 0n) throw invalid();
    let exchangeRate: string | null = null;
    let exchangeRateSource: string | null = null;
    if (currency === 'RSD') {
      if (body.exchangeRate != null || body.exchangeRateSource != null)
        throw invalid();
    } else {
      const raw = requiredText(body.exchangeRate, 80);
      if (!/^\d+(?:\.\d+)?$/.test(raw)) throw invalid();
      const [integer, fraction = ''] = raw.split('.');
      const whole = integer.replace(/^0+(?=\d)/, '');
      const fractional = fraction.replace(/0+$/, '');
      exchangeRate = fractional ? `${whole}.${fractional}` : whole;
      exchangeRateSource = requiredText(body.exchangeRateSource, 200);
    }
    recordConversion(amount, currency, exchangeRate, exchangeRateSource);
    let reserveFunding: PostingInput['reserveFunding'];
    if ('reserveFunding' in body) {
      if (body.type !== 'expense') throw invalid();
      if (body.reserveFunding == null) reserveFunding = undefined;
      else {
        const f = validateRequest(ReserveFundingDto, body.reserveFunding);
        const fundingAmount = parseMinor(f.amountMinor);
        if (fundingAmount <= 0n || fundingAmount > amount) throw invalid();
        reserveFunding = {
          reserveId: requiredText(f.reserveId, 200),
          amountMinor: fundingAmount.toString(),
        };
      }
    }
    return {
      ...(reserveFunding !== undefined ? { reserveFunding } : {}),
      type: body.type,
      transactionDate: validateDate(body.transactionDate),
      accountId: requiredText(body.accountId, 200),
      categoryId: requiredText(body.categoryId, 200),
      amountMinor: amount.toString(),
      currency,
      exchangeRate,
      exchangeRateSource,
      merchant: optionalText(body.merchant ?? null, 200),
      note: optionalText(body.note ?? null, 2000),
    };
  } catch {
    throw invalid();
  }
}
const transferKeys = [
  'type',
  'transactionDate',
  'fromAccountId',
  'toAccountId',
  'debitAmountMinor',
  'creditAmountMinor',
  'debitCurrency',
  'creditCurrency',
  'fee',
  'merchant',
  'note',
];
export function transfer(
  body: Record<string, unknown>,
  replacement = false,
): TransferInput {
  validateRequest(replacement ? EditTransferDto : TransferDto, body);
  const required = replacement
    ? transferKeys
    : transferKeys.filter((k) => !['fee', 'merchant', 'note'].includes(k));
  if (required.some((k) => !(k in body)) || body.type !== 'transfer')
    throw invalid();
  try {
    const fromAccountId = requiredText(body.fromAccountId, 200);
    const toAccountId = requiredText(body.toAccountId, 200);
    if (fromAccountId === toAccountId) throw invalid();
    const debitAmount = parseMinor(body.debitAmountMinor);
    const creditAmount = parseMinor(body.creditAmountMinor);
    const debitCurrency = validateCurrency(body.debitCurrency);
    const creditCurrency = validateCurrency(body.creditCurrency);
    if (
      debitAmount <= 0n ||
      creditAmount <= 0n ||
      (debitCurrency === creditCurrency && debitAmount !== creditAmount)
    )
      throw invalid();
    let fee: TransferInput['fee'] = null;
    if (body.fee != null) {
      const f = validateRequest(TransferFeeDto, body.fee);
      const amount = parseMinor(f.amountMinor);
      if (amount <= 0n) throw invalid();
      let exchangeRate: string | null = null;
      let exchangeRateSource: string | null = null;
      if (debitCurrency === 'RSD') {
        if (f.exchangeRate != null || f.exchangeRateSource != null)
          throw invalid();
      } else {
        const raw = requiredText(f.exchangeRate, 80);
        if (!/^\d+(?:\.\d+)?$/.test(raw)) throw invalid();
        const [integer, fraction = ''] = raw.split('.');
        const whole = integer.replace(/^0+(?=\d)/, '');
        const fractional = fraction.replace(/0+$/, '');
        exchangeRate = fractional ? `${whole}.${fractional}` : whole;
        exchangeRateSource = requiredText(f.exchangeRateSource, 200);
      }
      const converted = recordConversion(
        amount,
        debitCurrency,
        exchangeRate,
        exchangeRateSource,
      );
      if (
        converted.rsdEquivalentMinor === null ||
        BigInt(converted.rsdEquivalentMinor) <= 0n
      )
        throw invalid();
      fee = {
        amountMinor: amount.toString(),
        categoryId: requiredText(f.categoryId, 200),
        exchangeRate,
        exchangeRateSource,
      };
    }
    return {
      type: 'transfer',
      transactionDate: validateDate(body.transactionDate),
      fromAccountId,
      toAccountId,
      debitAmountMinor: debitAmount.toString(),
      creditAmountMinor: creditAmount.toString(),
      debitCurrency,
      creditCurrency,
      fee,
      merchant: optionalText(body.merchant ?? null, 200),
      note: optionalText(body.note ?? null, 2000),
    };
  } catch {
    throw invalid();
  }
}
const refundKeys = [
  'type',
  'transactionDate',
  'purchaseTransactionId',
  'accountId',
  'amountMinor',
  'merchant',
  'note',
];
export function refund(
  body: Record<string, unknown>,
  replacement = false,
): RefundInput {
  validateRequest(replacement ? EditRefundDto : RefundDto, body);
  const required = replacement
    ? refundKeys
    : refundKeys.filter((k) => k !== 'merchant' && k !== 'note');
  if (required.some((k) => !(k in body)) || body.type !== 'refund')
    throw invalid();
  try {
    const amount = parseMinor(body.amountMinor);
    if (amount <= 0n) throw invalid();
    return {
      type: 'refund',
      transactionDate: validateDate(body.transactionDate),
      purchaseTransactionId: requiredText(body.purchaseTransactionId, 200),
      accountId: requiredText(body.accountId, 200),
      amountMinor: amount.toString(),
      merchant: optionalText(body.merchant ?? null, 200),
      note: optionalText(body.note ?? null, 2000),
    };
  } catch {
    throw invalid();
  }
}
function requestKey(value: unknown): string {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(value))
    throw invalid();
  return value;
}
export function normalizePostingBody(
  body: unknown,
): PostingInput | TransferInput | RefundInput {
  const raw = validateRequest<Record<string, unknown>>(
    (body as { type?: unknown })?.type === 'transfer'
      ? TransferDto
      : (body as { type?: unknown })?.type === 'refund'
        ? RefundDto
        : PostingDto,
    body,
  );
  return raw.type === 'transfer'
    ? transfer(raw)
    : raw.type === 'refund'
      ? refund(raw)
      : posting(raw);
}
@Injectable()
export class TransactionsService {
  constructor(private readonly repository: PostingRepository) {}
  create(identity: Identity, householdId: string, body: unknown, key: unknown) {
    return this.repository.post(
      identity,
      householdId,
      normalizePostingBody(body),
      requestKey(key),
    );
  }
  postImport(
    identity: Identity,
    householdId: string,
    input: PostingInput | TransferInput | RefundInput,
    hook: PostingHook,
  ) {
    return this.repository.post(
      identity,
      householdId,
      input,
      crypto.randomUUID(),
      hook,
    );
  }
  edit(identity: Identity, householdId: string, id: string, body: unknown) {
    const isTransfer = (body as { type?: unknown })?.type === 'transfer';
    const isRefund = (body as { type?: unknown })?.type === 'refund';
    const b = validateRequest<Record<string, unknown>>(
      isTransfer ? EditTransferDto : isRefund ? EditRefundDto : EditPostingDto,
      body,
    );
    return this.repository.edit(
      identity,
      householdId,
      id,
      isTransfer
        ? transfer(b, true)
        : isRefund
          ? refund(b, true)
          : posting(b, true),
      version(b.version),
    );
  }
  void(identity: Identity, householdId: string, id: string, body: unknown) {
    const b = validateRequest(TransactionVersionDto, body);
    return this.repository.void(identity, householdId, id, version(b.version));
  }
  get(identity: Identity, householdId: string, id: string) {
    return this.repository.get(identity, householdId, id);
  }
  async exportCsv(
    identity: Identity,
    householdId: string,
    query: unknown,
  ): Promise<string> {
    const q: Record<string, unknown> = validateRequest(
      TransactionExportQueryDto,
      query,
    );
    const chunks = ['\uFEFF' + CSV_HEADER];
    const encoder = new TextEncoder();
    let bytes = encoder.encode(chunks[0]).length;
    let cursor: string | null = null;
    do {
      const page = await this.list(identity, householdId, {
        ...q,
        limit: '100',
        ...(cursor ? { cursor } : {}),
      });
      const accounts: string[] = [],
        categories: string[] = [];
      for (const t of page.transactions) {
        if (t.type === 'transfer')
          accounts.push(t.fromAccountId, t.toAccountId);
        else {
          accounts.push(t.accountId);
          categories.push(t.categoryId);
        }
      }
      const labels = await this.repository.exportLabels(identity, householdId, {
        accounts,
        categories,
      });
      for (const record of page.transactions) {
        const row = csvRow(record, labels);
        bytes += encoder.encode(row).length;
        if (bytes > 8 * 1024 * 1024)
          throw apiError(
            413,
            'EXPORT_TOO_LARGE',
            'Export exceeds the maximum size; narrow the filters',
          );
        chunks.push(row);
      }
      cursor = page.nextCursor;
    } while (cursor);
    await this.repository.assertExportAccess(identity, householdId);
    return chunks.join('');
  }
  list(identity: Identity, householdId: string, query: unknown) {
    const q = validateRequest(TransactionListQueryDto, query);
    if (
      q.limit !== undefined &&
      (typeof q.limit !== 'string' || !/^(?:[1-9]|[1-9]\d|100)$/.test(q.limit))
    )
      throw invalid();
    const limit = q.limit === undefined ? 50 : Number(q.limit);
    let cursor: { transactionDate: string; id: string } | null = null;
    if (q.cursor !== undefined) {
      if (
        typeof q.cursor !== 'string' ||
        q.cursor.length > 1024 ||
        !/^[A-Za-z0-9_-]+$/.test(q.cursor)
      )
        throw invalid();
      try {
        const decoded: unknown = JSON.parse(
          atob(q.cursor.replace(/-/g, '+').replace(/_/g, '/')),
        );
        const c = validateRequest(TransactionCursorDto, decoded);
        cursor = {
          transactionDate: validateDate(c.transactionDate),
          id: requiredText(c.id, 200),
        };
        if (cursor.id !== c.id || Object.keys(c).length !== 2) throw invalid();
      } catch {
        throw invalid();
      }
    }
    const options: TransactionListOptions = { limit, cursor };
    try {
      if (q.search !== undefined) options.search = requiredText(q.search, 200);
      if (q.dateFrom !== undefined) options.dateFrom = validateDate(q.dateFrom);
      if (q.dateTo !== undefined) options.dateTo = validateDate(q.dateTo);
      if (
        options.dateFrom &&
        options.dateTo &&
        options.dateFrom > options.dateTo
      )
        throw invalid();
      if (q.status !== undefined) {
        if (q.status !== 'posted' && q.status !== 'void') throw invalid();
        options.status = q.status;
      }
      if (q.type !== undefined) {
        if (
          typeof q.type !== 'string' ||
          !['expense', 'income', 'transfer', 'fee', 'refund'].includes(q.type)
        )
          throw invalid();
        options.type = q.type as TransactionListOptions['type'];
      }
      for (const key of ['categoryId', 'accountId', 'ownerMemberId'] as const) {
        if (q[key] !== undefined) options[key] = requiredText(q[key], 200);
      }
      if (q.currency !== undefined)
        options.currency = validateCurrency(q.currency);
    } catch {
      throw invalid();
    }
    return this.repository.list(identity, householdId, options);
  }
}
