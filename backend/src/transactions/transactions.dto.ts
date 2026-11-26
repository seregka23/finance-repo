import { Allow, IsString, IsInt, Min, Max } from 'class-validator';
export class ReserveFundingDto {
  [key: string]: unknown;
  @Allow() declare reserveId: string;
  @Allow() declare amountMinor: string;
}
export class TransferFeeDto {
  [key: string]: unknown;
  @Allow() declare amountMinor: string;
  @Allow() declare categoryId: string;
  @Allow() declare exchangeRate?: string | null;
  @Allow() declare exchangeRateSource?: string | null;
}
export class PostingDto {
  [key: string]: unknown;
  @Allow() declare type: 'expense' | 'income';
  @IsString() declare transactionDate: string;
  @IsString() declare accountId: string;
  @IsString() declare categoryId: string;
  @IsString() declare amountMinor: string;
  @IsString() declare currency: string;
  @Allow() declare exchangeRate?: string | null;
  @Allow() declare exchangeRateSource?: string | null;
  @Allow() declare merchant?: string | null;
  @Allow() declare note?: string | null;
  @Allow() declare reserveFunding?: ReserveFundingDto | null;
}
export class EditPostingDto extends PostingDto {
  @Allow() declare version: number;
}
export class TransferDto {
  [key: string]: unknown;
  @Allow() declare type: 'transfer';
  @IsString() declare transactionDate: string;
  @IsString() declare fromAccountId: string;
  @IsString() declare toAccountId: string;
  @IsString() declare debitAmountMinor: string;
  @IsString() declare creditAmountMinor: string;
  @IsString() declare debitCurrency: string;
  @IsString() declare creditCurrency: string;
  @Allow() declare fee?: TransferFeeDto | null;
  @Allow() declare merchant?: string | null;
  @Allow() declare note?: string | null;
}
export class EditTransferDto extends TransferDto {
  @Allow() declare version: number;
}
export class RefundDto {
  [key: string]: unknown;
  @Allow() declare type: 'refund';
  @IsString() declare transactionDate: string;
  @IsString() declare purchaseTransactionId: string;
  @IsString() declare accountId: string;
  @IsString() declare amountMinor: string;
  @Allow() declare merchant?: string | null;
  @Allow() declare note?: string | null;
}
export class EditRefundDto extends RefundDto {
  @Allow() declare version: number;
}
export class TransactionVersionDto {
  [key: string]: unknown;
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) declare version: number;
}
export class TransactionExportQueryDto {
  [key: string]: unknown;
  @Allow() declare search?: string;
  @Allow() declare dateFrom?: string;
  @Allow() declare dateTo?: string;
  @Allow() declare type?: string;
  @Allow() declare status?: string;
  @Allow() declare categoryId?: string;
  @Allow() declare accountId?: string;
  @Allow() declare ownerMemberId?: string;
  @Allow() declare currency?: string;
}
export class TransactionListQueryDto extends TransactionExportQueryDto {
  @Allow() declare limit?: string;
  @Allow() declare cursor?: string;
}
export class TransactionCursorDto {
  [key: string]: unknown;
  @Allow() declare transactionDate: string;
  @Allow() declare id: string;
}
export type CreateTransactionDto = PostingDto | TransferDto | RefundDto;
export type EditTransactionDto =
  EditPostingDto | EditTransferDto | EditRefundDto;
