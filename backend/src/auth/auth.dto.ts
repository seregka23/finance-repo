import { IsString } from 'class-validator';
export class CredentialsDto {
  @IsString() declare email: string;
  @IsString() declare password: string;
}
