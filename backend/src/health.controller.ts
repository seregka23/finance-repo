import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './database/prisma.service.js';

export { DATABASE } from './database/database.tokens.js';

@Controller('api/health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<{ status: 'ok'; database: 'ok' }> {
    try {
      const result = await this.prisma.$queryRaw<
        { ok: number | bigint }[]
      >`SELECT 1 AS ok`;
      if (result[0]?.ok === 1 || result[0]?.ok === 1n) {
        return { status: 'ok', database: 'ok' };
      }
    } catch {
      // Return no query, binding, or database internals to the caller.
    }
    throw new ServiceUnavailableException('Database is unavailable');
  }
}
