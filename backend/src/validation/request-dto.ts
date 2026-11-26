import { Body, Query, type PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { getMetadataStorage, validateSync } from 'class-validator';
import { apiError } from '../auth/auth.errors.js';

export type RequestDtoClass<T extends object> = new () => T;
export type InvalidRequest = () => Error;
const defaultInvalid = () => apiError(400, 'INVALID_INPUT', 'Invalid input');
/** Validate without coercion or replacing the original object, preserving own-key/null semantics. */
export function validateRequest<T extends object>(
  dto: RequestDtoClass<T>,
  value: unknown,
  invalid: InvalidRequest = defaultInvalid,
): T {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw invalid();
  const keys = Object.keys(value);
  const allowed = new Set(
    getMetadataStorage()
      .getTargetValidationMetadatas(dto, '', false, false)
      .map((m) => m.propertyName),
  );
  if (keys.some((k) => !allowed.has(k))) throw invalid();
  const instance = plainToInstance(dto, value, {
    enableImplicitConversion: false,
  });
  if (
    validateSync(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    }).length
  )
    throw invalid();
  return value as T;
}
export class RequestDtoPipe<T extends object> implements PipeTransform<
  unknown,
  T
> {
  constructor(
    private readonly dto: RequestDtoClass<T>,
    private readonly invalid: InvalidRequest = defaultInvalid,
  ) {}
  transform(value: unknown): T {
    return validateRequest(this.dto, value, this.invalid);
  }
}
export const BodyDto = <T extends object>(
  dto: RequestDtoClass<T>,
): ParameterDecorator => Body(new RequestDtoPipe(dto));
export const QueryDto = <T extends object>(
  dto: RequestDtoClass<T>,
): ParameterDecorator => Query(new RequestDtoPipe(dto));
