import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { DATABASE } from './health.controller.js';

interface ProbeStatement {
  bind(...values: string[]): ProbeStatement;
  run(): Promise<unknown>;
  first<T>(): Promise<T | null>;
}

export interface ProbeDatabase {
  prepare(query: string): ProbeStatement;
}

interface Probe {
  id: string;
  value: string;
}

@Injectable()
export class InfrastructureProbeService {
  constructor(@Inject(DATABASE) private readonly database: ProbeDatabase) {}

  async create(value: string): Promise<Probe> {
    const probe = { id: crypto.randomUUID(), value };
    try {
      await this.database
        .prepare('INSERT INTO infrastructure_probe (id, value) VALUES (?, ?)')
        .bind(probe.id, probe.value)
        .run();
      return probe;
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }
  }

  async get(id: string): Promise<Probe> {
    let probe: Probe | null;
    try {
      probe = await this.database
        .prepare('SELECT id, value FROM infrastructure_probe WHERE id = ?')
        .bind(id)
        .first<Probe>();
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }
    if (!probe) throw new NotFoundException();
    return probe;
  }

  async delete(id: string): Promise<void> {
    try {
      await this.database
        .prepare('DELETE FROM infrastructure_probe WHERE id = ?')
        .bind(id)
        .run();
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }
  }
}

function validateHost(request: Request): void {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(request.hostname)) {
    throw new NotFoundException();
  }
}

function validateId(id: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    throw new BadRequestException('Invalid probe id');
  }
}

@Controller('api/infrastructure/probe')
export class InfrastructureProbeController {
  constructor(private readonly service: InfrastructureProbeService) {}

  @Post()
  create(@Req() request: Request, @Body() body: unknown): Promise<Probe> {
    validateHost(request);
    if (
      typeof body !== 'object' ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('value' in body) ||
      typeof body.value !== 'string' ||
      body.value.length < 1 ||
      body.value.length > 256
    )
      throw new BadRequestException('Invalid probe body');
    return this.service.create(body.value);
  }

  @Get(':id')
  get(@Req() request: Request, @Param('id') id: string): Promise<Probe> {
    validateHost(request);
    validateId(id);
    return this.service.get(id);
  }

  @Delete(':id')
  @HttpCode(204)
  delete(@Req() request: Request, @Param('id') id: string): Promise<void> {
    validateHost(request);
    validateId(id);
    return this.service.delete(id);
  }
}
