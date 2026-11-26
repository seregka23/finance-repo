import { Allow, IsString, IsIn } from 'class-validator';
export class CreateReserveDto {
  [key: string]: unknown;
  @IsString() declare accountId: string;
  @IsString() declare name: string;
}
export class ReserveMovementDto {
  [key: string]: unknown;
  @IsIn(['allocation', 'release']) declare type: 'allocation' | 'release';
  @IsString() declare amountMinor: string;
}
export class ReserveMovementQueryDto {
  [key: string]: unknown;
  @Allow() declare limit?: string;
  @Allow() declare cursor?: string;
}
export class ReserveCursorDto {
  [key: string]: unknown;
  @Allow() declare movementDate: string;
  @Allow() declare id: string;
}
