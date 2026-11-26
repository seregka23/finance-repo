import { Allow, IsIn, ValidateIf } from 'class-validator';
export class CategoryListQueryDto {
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsIn(['all', 'active', 'archived'])
  declare status?: 'all' | 'active' | 'archived';
}
export class CategoryOptionsQueryDto {
  @IsIn(['expense', 'income', 'fee', 'refund', 'budget', 'transfer'])
  declare usage:
    'expense' | 'income' | 'fee' | 'refund' | 'budget' | 'transfer';
}
export class CreateCategoryDto {
  @Allow() declare name?: string;
  @Allow() declare type?: 'expense' | 'income';
}
export class UpdateCategoryDto {
  @Allow() declare name?: string;
  @Allow() declare status?: 'active' | 'archived';
}
