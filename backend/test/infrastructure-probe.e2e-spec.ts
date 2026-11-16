import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { WorkerModule } from '../src/worker.module.js';

describe('local infrastructure probe', () => {
  let app: INestApplication<App>;
  const first = vi.fn();
  const run = vi.fn();
  const bind = vi.fn(() => ({ first, run }));
  const prepare = vi.fn(() => ({ first, bind }));
  async function start(enabled?: boolean) {
    const module = await Test.createTestingModule({
      imports: [WorkerModule.register({ prepare }, enabled)],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  }
  beforeEach(() => {
    vi.clearAllMocks();
    first.mockReset();
    run.mockReset();
  });
  afterEach(async () => app.close());
  it('does not register the route by default', async () => {
    await start();
    await request(app.getHttpServer())
      .post('/api/infrastructure/probe')
      .set('Host', 'localhost')
      .send({ value: 'x' })
      .expect(404);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('creates, reads, and deletes a probe with bound values', async () => {
    await start(true);
    const value = "quote ' and ?";
    const created = await request(app.getHttpServer())
      .post('/api/infrastructure/probe')
      .set('Host', 'localhost')
      .send({ value })
      .expect(201);
    const id = created.body.id as string;
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.body).toEqual({ id, value });
    expect(prepare).toHaveBeenCalledWith(
      'INSERT INTO infrastructure_probe (id, value) VALUES (?, ?)',
    );
    expect(bind).toHaveBeenCalledWith(id, value);
    first.mockResolvedValueOnce({ id, value });
    await request(app.getHttpServer())
      .get(`/api/infrastructure/probe/${id}`)
      .set('Host', '127.0.0.1')
      .expect(200)
      .expect({ id, value });
    expect(prepare).toHaveBeenCalledWith(
      'SELECT id, value FROM infrastructure_probe WHERE id = ?',
    );
    await request(app.getHttpServer())
      .delete(`/api/infrastructure/probe/${id}`)
      .set('Host', '[::1]')
      .expect(204);
    expect(prepare).toHaveBeenCalledWith(
      'DELETE FROM infrastructure_probe WHERE id = ?',
    );
    expect(bind).toHaveBeenLastCalledWith(id);
    first.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .get(`/api/infrastructure/probe/${id}`)
      .set('Host', 'localhost')
      .expect(404);
  });
  it('rejects invalid bodies and ids before accessing the database', async () => {
    await start(true);
    for (const body of [
      {},
      { value: '' },
      { value: 'x'.repeat(257) },
      { value: 1 },
      { value: 'x', extra: true },
      [],
    ]) {
      await request(app.getHttpServer())
        .post('/api/infrastructure/probe')
        .set('Host', 'localhost')
        .send(body)
        .expect(400);
    }
    await request(app.getHttpServer())
      .get('/api/infrastructure/probe/not-a-uuid')
      .set('Host', 'localhost')
      .expect(400);
    await request(app.getHttpServer())
      .delete('/api/infrastructure/probe/not-a-uuid')
      .set('Host', 'localhost')
      .expect(400);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('rejects public hostnames', async () => {
    await start(true);
    await request(app.getHttpServer())
      .post('/api/infrastructure/probe')
      .set('Host', 'example.com')
      .send({ value: 'x' })
      .expect(404);
    expect(prepare).not.toHaveBeenCalled();
  });
  it('sanitizes database errors for writes and reads', async () => {
    await start(true);
    const id = 'b7c21d1b-783d-4d06-9c78-c9a1c82a7136';
    run.mockRejectedValue(new Error('private database detail'));
    first.mockRejectedValue(new Error('private database detail'));
    const responses = [
      await request(app.getHttpServer())
        .post('/api/infrastructure/probe')
        .set('Host', 'localhost')
        .send({ value: 'x' })
        .expect(503),
      await request(app.getHttpServer())
        .get(`/api/infrastructure/probe/${id}`)
        .set('Host', 'localhost')
        .expect(503),
      await request(app.getHttpServer())
        .delete(`/api/infrastructure/probe/${id}`)
        .set('Host', 'localhost')
        .expect(503),
    ];
    for (const response of responses) {
      expect(response.body.message).toBe('Database is unavailable');
      expect(response.text).not.toContain('private database detail');
    }
  });
});
