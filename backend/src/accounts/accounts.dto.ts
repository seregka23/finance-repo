import { Allow, IsInt, Min, Max } from 'class-validator';
class AccountMetadataDto {
  @Allow() declare name?: string;
  @Allow() declare type?: 'cash' | 'bank' | 'card';
  @Allow() declare currency?: string;
  @Allow() declare ownerMemberId?: string | null;
  @Allow() declare designation?: 'personal' | 'business';
  @Allow() declare bankName?: string | null;
  @Allow() declare cardLastFour?: string | null;
}
export class CreateAccountDto extends AccountMetadataDto {
  @Allow() declare openingBalanceMinor?: string;
  @Allow() declare openingDate?: string;
}
export class UpdateAccountDto extends AccountMetadataDto {
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) declare version: number;
}
export class AccountVersionDto {
  @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) declare version: number;
}
export class AccountAdjustmentDto extends AccountVersionDto {
  @Allow() declare amountMinor?: string;
  @Allow() declare movementDate?: string;
}
export class AccountListQueryDto {
  @Allow() declare status?: 'all' | 'active' | 'archived' | null;
}
export class MovementQueryDto {
  @Allow() declare limit?: string;
  @Allow() declare cursor?: string;
}
