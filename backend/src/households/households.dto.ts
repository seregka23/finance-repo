import { Allow } from 'class-validator';
export class HouseholdDto {
  @Allow() declare name?: string;
  @Allow() declare timeZone?: string;
}
export class InviteDto {
  @Allow() declare email?: string;
}
export class AcceptInvitationDto {
  @Allow() declare token?: string;
}
