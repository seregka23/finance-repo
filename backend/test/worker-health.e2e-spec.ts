import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { WorkerModule } from '../src/worker.module.js';

describe('Worker API', () => {
  let app: INestApplication<App>;
  const first = vi.fn();
  const prepare = vi.fn(() => ({ first }));

  beforeEach(async () => {
    first.mockReset();
    prepare.mockClear();
    const module = await Test.createTestingModule({
      imports: [WorkerModule.register({ prepare })],
    }).compile();
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

  it('checks D1 through the injected binding', async () => {
    first.mockResolvedValue({ ok: 1 });
    await request(app.getHttpServer())
      .get('/api/health')
      .expect(200)
      .expect({ status: 'ok', database: 'ok' });
    expect(prepare).toHaveBeenCalledWith('SELECT 1 AS ok');
  });

  it('sanitizes database failures', async () => {
    first.mockRejectedValue(new Error('private database detail'));
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(503);
    expect(response.body.message).toBe('Database is unavailable');
    expect(response.text).not.toContain('private database detail');
  });

  it('rejects an unexpected database result', async () => {
    first.mockResolvedValue(null);
    await request(app.getHttpServer()).get('/api/health').expect(503);
  });
});
