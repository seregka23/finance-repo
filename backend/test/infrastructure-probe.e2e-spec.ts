import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { WorkerModule } from '../src/worker.module.js';

describe('local infrastructure probe', () => {
  let app: INestApplication<App>;
  const infrastructureProbe = {
    create: vi.fn(),
    findUnique: vi.fn(),
    deleteMany: vi.fn(),
  };
  function expectNoDatabaseAccess() {
    for (const operation of Object.values(infrastructureProbe))
      expect(operation).not.toHaveBeenCalled();
  }
  async function start(enabled?: boolean) {
    const module = await Test.createTestingModule({
      imports: [WorkerModule.register({} as D1Database, enabled)],
    })
      .overrideProvider(PrismaService)
      .useValue({ infrastructureProbe })
      .compile();
    app = module.createNestApplication();
    await app.init();
  }
  beforeEach(() => {
    vi.resetAllMocks();
  });
  afterEach(async () => app.close());
  it('does not register the route by default', async () => {
    await start();
    await request(app.getHttpServer())
      .post('/api/infrastructure/probe')
      .set('Host', 'localhost')
      .send({ value: 'x' })
      .expect(404);
    expectNoDatabaseAccess();
  });
  it('creates, reads, and deletes a probe through Prisma', async () => {
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
    expect(infrastructureProbe.create).toHaveBeenCalledWith({
      data: { id, value },
    });
    infrastructureProbe.findUnique.mockResolvedValueOnce({ id, value });
    await request(app.getHttpServer())
      .get(`/api/infrastructure/probe/${id}`)
      .set('Host', '127.0.0.1')
      .expect(200)
      .expect({ id, value });
    expect(infrastructureProbe.findUnique).toHaveBeenCalledWith({
      where: { id },
    });
    await request(app.getHttpServer())
      .delete(`/api/infrastructure/probe/${id}`)
      .set('Host', '[::1]')
      .expect(204);
    expect(infrastructureProbe.deleteMany).toHaveBeenCalledWith({
      where: { id },
    });
    infrastructureProbe.findUnique.mockResolvedValueOnce(null);
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
    expectNoDatabaseAccess();
  });
  it('rejects public hostnames', async () => {
    await start(true);
    await request(app.getHttpServer())
      .post('/api/infrastructure/probe')
      .set('Host', 'example.com')
      .send({ value: 'x' })
      .expect(404);
    expectNoDatabaseAccess();
  });
  it('sanitizes database errors for writes and reads', async () => {
    await start(true);
    const id = 'b7c21d1b-783d-4d06-9c78-c9a1c82a7136';
    for (const operation of Object.values(infrastructureProbe))
      operation.mockRejectedValue(new Error('private database detail'));
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
