import { Allow } from 'class-validator';
export class MonthlyReportQueryDto {
  [key: string]: unknown;
  @Allow() declare month?: string;
  @Allow() declare categoryId?: string;
  @Allow() declare merchant?: string;
}
