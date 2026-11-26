import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service.js';
import type { CredentialsDto } from './auth.dto.js';
import { lifetime } from './auth.crypto.js';
import { cookieToken, origin } from './auth.http.js';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Get('config') config() {
    return { configured: true, signInUrl: null, signOutUrl: null };
  }
  private async signIn(
    body: unknown,
    req: Request,
    res: Response,
    register: boolean,
  ) {
    const result = await this.auth.authenticate(
      body,
      req.get('x-internal-client-ip') ?? '',
      register,
    );
    res.setHeader(
      'Set-Cookie',
      `finance_session=${result.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${lifetime}${origin(req).protocol === 'https:' ? '; Secure' : ''}`,
    );
    return { user: { email: result.email } };
  }
  @Post('register') register(
    @Body() body: CredentialsDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.signIn(body, req, res, true);
  }
  @Post('login') @HttpCode(200) login(
    @Body() body: CredentialsDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.signIn(body, req, res, false);
  }
  @Post('logout') @HttpCode(204) async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(cookieToken(req));
    res.setHeader(
      'Set-Cookie',
      `finance_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${origin(req).protocol === 'https:' ? '; Secure' : ''}`,
    );
  }
}
