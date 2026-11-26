import { IsString } from 'class-validator';
export class ProbeDto {
  @IsString() declare value: string;
}
