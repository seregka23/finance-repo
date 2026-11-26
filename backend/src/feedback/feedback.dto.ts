import { IsString } from 'class-validator';
export class FeedbackDto {
  @IsString() declare title: string;
  @IsString() declare message: string;
}
