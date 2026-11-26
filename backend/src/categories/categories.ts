import {
  Controller,
  Get,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  validateRequest,
  QueryDto,
  BodyDto,
} from '../validation/request-dto.js';
import {
  CategoryListQueryDto,
  CategoryOptionsQueryDto,
  CreateCategoryDto,
  UpdateCategoryDto,
} from './categories.dto.js';
import { apiError } from '../auth/auth.js';
import type { Identity } from '../auth/auth.js';
import { CurrentIdentity } from '../auth/current-identity.decorator.js';
import { DATABASE } from '../health.controller.js';
import {
  HouseholdAccessService,
  type Database,
} from '../households/households.js';

export type CategoryUsage =
  'expense' | 'income' | 'fee' | 'refund' | 'budget' | 'transfer';
export type CategoryType = 'expense' | 'income';
export type CategoryStatus = 'active' | 'archived';
export interface Category {
  id: string;
  name: string;
  type: CategoryType;
  status: CategoryStatus;
  createdAt: string;
  updatedAt: string;
}
const columns =
  'id,name,type,status,created_at AS createdAt,updated_at AS updatedAt';
const invalid = () => apiError(400, 'INVALID_INPUT', 'Invalid input');
const notFound = () =>
  apiError(404, 'CATEGORY_NOT_FOUND', 'Category not found');
function categoryName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < 1 ||
    value.trim().length > 80
  )
    throw invalid();
  return value.trim();
}
function usageValue(value: unknown): CategoryUsage {
  if (
    value !== 'expense' &&
    value !== 'income' &&
    value !== 'fee' &&
    value !== 'refund' &&
    value !== 'budget' &&
    value !== 'transfer'
  )
    throw invalid();
  return value;
}
@Injectable()
export class CategoryService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: HouseholdAccessService,
  ) {}

  // Include this assertion in the same authorized batch as the dependent write.
  selectionStatement(
    householdId: string,
    categoryId: string | null,
    usage: CategoryUsage,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        'INSERT INTO category_selection_checks (household_id,category_id,usage) VALUES (?,?,?)',
      )
      .bind(householdId, categoryId, usage);
  }
  async list(identity: Identity, householdId: string, query: unknown) {
    const q = validateRequest(CategoryListQueryDto, query);
    const status = q.status === undefined ? 'all' : q.status;
    const [, result] = await this.access.batch(
      identity,
      householdId,
      'member',
      [
        this.db
          .prepare(
            `SELECT ${columns} FROM categories WHERE household_id=? AND (?='all' OR status=?) ORDER BY name,id`,
          )
          .bind(householdId, status, status),
      ],
    );
    return { categories: result.results as unknown as Category[] };
  }
  async listEligible(
    identity: Identity,
    householdId: string,
    usage: CategoryUsage,
  ): Promise<Category[]> {
    usageValue(usage);
    const type =
      usage === 'transfer' ? null : usage === 'income' ? 'income' : 'expense';
    const [, result] = await this.access.batch(
      identity,
      householdId,
      'member',
      [
        this.db
          .prepare(
            `SELECT ${columns} FROM categories WHERE household_id=? AND status='active' AND type=? ORDER BY name,id`,
          )
          .bind(householdId, type),
      ],
    );
    return result.results as unknown as Category[];
  }
  async options(identity: Identity, householdId: string, query: unknown) {
    const q = validateRequest(CategoryOptionsQueryDto, query);
    const usage = usageValue(q.usage);
    return {
      usage,
      categories: await this.listEligible(identity, householdId, usage),
    };
  }
  async referenceNames(identity: Identity, householdId: string) {
    await this.access.batch(identity, householdId, 'member', []);
    return {
      expense: ['Groceries', 'Utilities', 'Transport'],
      income: ['Salary', 'Other income'],
    };
  }
  async get(
    identity: Identity,
    householdId: string,
    id: string,
  ): Promise<Category> {
    const [, result] = await this.access.batch(
      identity,
      householdId,
      'member',
      [
        this.db
          .prepare(
            `SELECT ${columns} FROM categories WHERE household_id=? AND id=?`,
          )
          .bind(householdId, id),
      ],
    );
    const category = result.results[0] as unknown as Category | undefined;
    if (!category) throw notFound();
    return category;
  }
  async create(
    identity: Identity,
    householdId: string,
    body: unknown,
  ): Promise<Category> {
    const b = validateRequest(CreateCategoryDto, body);
    const name = categoryName(b.name);
    if (b.type !== 'expense' && b.type !== 'income') throw invalid();
    const category: Category = {
      id: crypto.randomUUID(),
      name,
      type: b.type,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: '',
    };
    category.updatedAt = category.createdAt;
    await this.access.batch(identity, householdId, 'member', [
      this.db
        .prepare(
          'INSERT INTO categories (id,household_id,name,type,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        )
        .bind(
          category.id,
          householdId,
          category.name,
          category.type,
          category.status,
          category.createdAt,
          category.updatedAt,
        ),
    ]);
    return category;
  }
  async update(
    identity: Identity,
    householdId: string,
    id: string,
    body: unknown,
  ): Promise<Category> {
    const b = validateRequest(UpdateCategoryDto, body);
    if (!Object.keys(b).length) throw invalid();
    const name =
      b.name === undefined && !('name' in b) ? null : categoryName(b.name);
    const status = b.status === undefined && !('status' in b) ? null : b.status;
    if ('status' in b && status !== 'active' && status !== 'archived')
      throw invalid();
    const [, result] = await this.access.batch(
      identity,
      householdId,
      'member',
      [
        this.db
          .prepare(
            `UPDATE categories SET name=COALESCE(?,name),status=COALESCE(?,status),updated_at=? WHERE household_id=? AND id=? RETURNING ${columns}`,
          )
          .bind(name, status, new Date().toISOString(), householdId, id),
      ],
    );
    const category = result.results[0] as unknown as Category | undefined;
    if (!category) throw notFound();
    return category;
  }
}
@Controller('api/v1/households/:householdId/categories')
export class CategoriesController {
  constructor(private readonly service: CategoryService) {}
  @Get() list(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @QueryDto(CategoryListQueryDto) q: CategoryListQueryDto,
  ) {
    return this.service.list(identity, h, q);
  }
  @Get('options') options(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @QueryDto(CategoryOptionsQueryDto) q: CategoryOptionsQueryDto,
  ) {
    return this.service.options(identity, h, q);
  }
  @Get('reference-names') referenceNames(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
  ) {
    return this.service.referenceNames(identity, h);
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
    @BodyDto(CreateCategoryDto) body: CreateCategoryDto,
  ) {
    return this.service.create(identity, h, body);
  }
  @Patch(':id') update(
    @CurrentIdentity() identity: Identity,
    @Param('householdId') h: string,
    @Param('id') id: string,
    @BodyDto(UpdateCategoryDto) body: UpdateCategoryDto,
  ) {
    return this.service.update(identity, h, id, body);
  }
}
