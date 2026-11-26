import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { WorkerModule } from '../src/worker.module.js';

describe('Worker API', () => {
  let app: INestApplication<App>;
  const queryRaw = vi.fn();

  beforeEach(async () => {
    queryRaw.mockReset();
    const module = await Test.createTestingModule({
      imports: [WorkerModule.register({} as D1Database)],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: queryRaw })
      .compile();
    app = module.createNestApplication();
    await app.init();
  });

  afterEach(async () => app.close());

  it('preserves the Angular greeting endpoint', async () => {
    await request(app.getHttpServer())
      .get('/api/hello')
      .expect(200)
      .expect({ message: 'Hello World!' });
  });

  it('checks database connectivity through Prisma', async () => {
    queryRaw.mockResolvedValue([{ ok: 1 }]);
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', database: 'ok' });
    expect(queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining(['SELECT 1 AS ok']),
    );
  });

  it('sanitizes database failures', async () => {
    queryRaw.mockRejectedValue(new Error('private database detail'));
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(503);
    expect(response.body.message).toBe('Database is unavailable');
    expect(response.text).not.toContain('private database detail');
  });

  it('rejects an unexpected database result', async () => {
    queryRaw.mockResolvedValue([]);
    await request(app.getHttpServer()).get('/api/health').expect(503);
  });
});
