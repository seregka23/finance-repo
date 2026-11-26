import 'reflect-metadata';
import { httpServerHandler } from 'cloudflare:node';
import { env } from 'cloudflare:workers';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { WorkerModule } from './worker.module.js';
import express from 'express';

const handler = httpServerHandler({ port: 3000 });
let application: Promise<INestApplication> | undefined;

function initialize(): Promise<INestApplication> {
  application ??= NestFactory.create(
    WorkerModule.register(
      env.DB,
      env.INFRASTRUCTURE_PROBE_ENABLED === 'true',
      'OPENAI_API_KEY' in env && typeof env.OPENAI_API_KEY === 'string'
        ? env.OPENAI_API_KEY
        : null,
      {
        provider:
          'CATEGORY_DECISION_PROVIDER' in env
            ? typeof env.CATEGORY_DECISION_PROVIDER === 'string'
              ? env.CATEGORY_DECISION_PROVIDER
              : ''
            : null,
        openaiKey:
          'OPENAI_API_KEY' in env && typeof env.OPENAI_API_KEY === 'string'
            ? env.OPENAI_API_KEY
            : null,
        geminiKey:
          'GEMINI_API_KEY' in env && typeof env.GEMINI_API_KEY === 'string'
            ? env.GEMINI_API_KEY
            : null,
        openaiMinProbability:
          'CATEGORY_DECISION_OPENAI_MIN_PROBABILITY' in env
            ? typeof env.CATEGORY_DECISION_OPENAI_MIN_PROBABILITY === 'string'
              ? env.CATEGORY_DECISION_OPENAI_MIN_PROBABILITY
              : ''
            : null,
        geminiMinProbability:
          'CATEGORY_DECISION_GEMINI_MIN_PROBABILITY' in env
            ? typeof env.CATEGORY_DECISION_GEMINI_MIN_PROBABILITY === 'string'
              ? env.CATEGORY_DECISION_GEMINI_MIN_PROBABILITY
              : ''
            : null,
      },
      'GITHUB_FEEDBACK_TOKEN' in env &&
        typeof env.GITHUB_FEEDBACK_TOKEN === 'string'
        ? env.GITHUB_FEEDBACK_TOKEN
        : null,
    ),
    {
      logger: ['error', 'warn'],
      abortOnError: false,
    },
  )
    .then(async (app) => {
      app.use(
        '/api/v1',
        (
          _req: unknown,
          res: { setHeader(name: string, value: string): void },
          next: () => void,
        ) => {
          res.setHeader('Cache-Control', 'no-store');
          next();
        },
      );
      const extractionParser = express.json({ limit: '1500kb' });
      // A wrapper avoids Nest mistaking this route-local parser for its global parser.
      app.use(
        [
          '/api/v1/households/:householdId/imports/extract',
          '/api/v1/households/:householdId/imports/preview',
        ],
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => extractionParser(req, res, next),
      );
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
      const headers = new Headers(request.headers);
      headers.set('x-internal-request-origin', new URL(request.url).origin);
      headers.set(
        'x-internal-client-ip',
        request.headers.get('cf-connecting-ip') || 'unknown',
      );
      return await handler.fetch(
        new Request(request, { headers }) as typeof request,
        bindings,
        context,
      );
    } catch {
      return Response.json({ status: 'error' }, { status: 503 });
    }
  },
} satisfies ExportedHandler<Env>;
