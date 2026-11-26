import { Allow, IsString, IsIn } from 'class-validator';
export class SmsExtractionDto {
  [key: string]: unknown;
  @IsIn(['sms']) declare sourceType: 'sms';
  @IsString() declare text: string;
}
export class ImageExtractionDto {
  [key: string]: unknown;
  @Allow() declare sourceType: 'image';
  @IsString() declare mimeType: string;
  @IsString() declare base64: string;
}
export class PreviewImportDto {
  [key: string]: unknown;
  @Allow() declare sourceType: 'sms' | 'screenshot' | 'receipt';
  @Allow() declare text?: string;
  @Allow() declare mimeType?: string;
  @Allow() declare base64?: string;
}
export class ConfirmImportDto {
  [key: string]: unknown;
  @Allow() declare mode: 'post' | 'attach';
  @Allow() declare transaction?: unknown;
  @Allow() declare transactionId?: string;
  @Allow() declare items: ReceiptItemDto[];
  @Allow() declare settlementConfirmed?: boolean;
}
export class ReceiptItemDto {
  [key: string]: unknown;
  @Allow() declare name: string;
  @Allow() declare quantity: string | null;
  @Allow() declare unitPriceMinor: string | null;
  @Allow() declare amountMinor: string | null;
}
export type ExtractionInputDto = SmsExtractionDto | ImageExtractionDto;
