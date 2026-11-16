import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';

export const DATABASE = Symbol('DATABASE');

export interface HealthDatabase {
  prepare(query: string): Pick<D1PreparedStatement, 'first'>;
}

@Controller('api/health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly database: HealthDatabase) {}

  @Get()
  async check(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      const result = await this.database
        .prepare('SELECT 1 AS ok')
        .first<{ ok: number }>();
      if (result?.ok === 1) {
        return { status: 'ok', database: 'ok' };
      }
    } catch {
      // Return no query, binding, or database internals to the caller.
    }
    throw new ServiceUnavailableException('Database is unavailable');
  }
}
