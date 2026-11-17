import type { Request } from 'express';

export interface Identity {
  subject: string;
  email: string;
}
export type AuthRequest = Request & { identity: Identity };
