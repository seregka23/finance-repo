import { Allow, IsString } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { RequestDtoPipe, validateRequest } from './request-dto.js';

class BaseDto {
  @IsString() declare name: string;
}
class ExampleDto extends BaseDto {
  @Allow() declare optional?: string | null;
}

describe('request DTO validation', () => {
  it('preserves original own keys, explicit null and undefined', () => {
    const omitted = { name: 'test' };
    expect(validateRequest(ExampleDto, omitted)).toBe(omitted);
    expect(Object.hasOwn(omitted, 'optional')).toBe(false);
    const present = { name: 'test', optional: null };
    expect(new RequestDtoPipe(ExampleDto).transform(present)).toBe(present);
    const undefinedValue = { name: 'test', optional: undefined };
    expect(
      Object.hasOwn(validateRequest(ExampleDto, undefinedValue), 'optional'),
    ).toBe(true);
  });

  it('rejects unknown keys, wrong types and nonobjects without coercion', () => {
    for (const input of [
      null,
      [],
      3,
      { name: 3 },
      { name: 'test', extra: 1 },
      JSON.parse('{"name":"test","__proto__":{}}'),
    ]) {
      expect(() => validateRequest(ExampleDto, input)).toThrow();
    }
  });
});
