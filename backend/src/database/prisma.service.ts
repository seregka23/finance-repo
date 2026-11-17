import { Inject, Injectable } from '@nestjs/common';
import { PrismaD1 } from '@prisma/adapter-d1';
import { DATABASE } from './database.tokens.js';
import { PrismaClient } from '../generated/prisma/client.js';

// D1Database is a binding type, not a JavaScript global constructor. The alias
// prevents decorator metadata from referencing a nonexistent runtime value.
type D1Binding = D1Database;

@Injectable()
export class PrismaService extends PrismaClient {
  constructor(@Inject(DATABASE) database: D1Binding) {
    super({ adapter: new PrismaD1(database) });
  }

  // D1's Prisma adapter cannot provide atomic transactions. Keep compound
  // writes in D1 batch operations, which execute atomically.
  override $transaction: PrismaClient['$transaction'] = () => {
    throw new Error(
      'Prisma transactions are unsupported on D1; use an atomic D1 batch instead',
    );
  };
}
