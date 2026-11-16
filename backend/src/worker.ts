import 'reflect-metadata';
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { WorkerModule } from './worker.module.js';

const handler = httpServerHandler({ port: 3000 });
let application: Promise<INestApplication> | undefined;

function initialize(): Promise<INestApplication> {
  application ??= NestFactory.create(
    WorkerModule.register(env.DB, env.INFRASTRUCTURE_PROBE_ENABLED === 'true'),
    {
      logger: ['error', 'warn'],
      abortOnError: false,
    },
  )
    .then(async (app) => {
      await app.listen(3000);
      return app;
    })
    .catch((error: unknown) => {
      application = undefined;
      throw error;
    });
  return application;
}

export default {
  async fetch(request, bindings, context) {
    try {
      // Initialize in the first request context, never perform I/O at module load.
      await initialize();
      if (!handler.fetch) throw new Error('Node HTTP handler is unavailable');
      return await handler.fetch(request, bindings, context);
    } catch {
      return Response.json({ status: 'error' }, { status: 503 });
    }
  },
} satisfies ExportedHandler<Env>;
