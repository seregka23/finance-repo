import { Allow, IsString } from 'class-validator';
export class PlanQueryDto {
  [key: string]: unknown;
  @Allow() declare month?: string;
}
export class CreatePlanDto {
  [key: string]: unknown;
  @IsString() declare month: string;
  @IsString() declare categoryId: string;
  @IsString() declare limitMinor: string;
}
export class UpdatePlanDto {
  [key: string]: unknown;
  @IsString() declare limitMinor: string;
}
