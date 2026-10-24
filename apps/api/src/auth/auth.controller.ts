import { BadRequestException, Body, Controller, Get, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Me, UserSettings } from '@cowork/shared';
import { env } from '../config/env';
import { AuthService } from './auth.service';
import { Auth, type AuthContext } from './auth.types';
import { Public, SESSION_COOKIE } from './session.guard';
import { SettingsService } from './settings.service';

const cookieOpts = { httpOnly: true, sameSite: 'lax' as const, secure: env.WEB_ORIGIN.startsWith('https'), path: '/' };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
  ) {}

  @Public()
  @Get('config')
  config() {
    return { authMode: env.AUTH_MODE, cortexMock: env.CORTEX_MOCK };
  }

  @Public()
  @Get('login')
  async login(@Res() res: Response) {
    if (env.AUTH_MODE === 'spcs') return res.redirect('/');
    if (env.AUTH_MODE !== 'oauth') return res.redirect(`${env.WEB_ORIGIN}/login`);
    res.redirect(await this.auth.authorizeUrl());
  }

  @Public()
  @Get('callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Query('error') error: string, @Res() res: Response) {
    if (error || !code) return res.redirect(`${env.WEB_ORIGIN}/login?error=${encodeURIComponent(error ?? 'missing_code')}`);
    const sid = await this.auth.handleCallback(code, state);
    res.cookie(SESSION_COOKIE, sid, { ...cookieOpts, maxAge: 7 * 86400_000 });
    res.redirect(env.WEB_ORIGIN);
  }

  @Public()
  @Post('dev-login')
  async devLogin(@Body() body: { name?: string }, @Res({ passthrough: true }) res: Response) {
    if (env.AUTH_MODE !== 'dev') throw new BadRequestException('dev login is disabled');
    const sid = await this.auth.devLogin(body.name?.trim() || 'demo');
    res.cookie(SESSION_COOKIE, sid, { ...cookieOpts, maxAge: 7 * 86400_000 });
    return { ok: true };
  }

  @Post('logout')
  async logout(@Auth() a: AuthContext, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(a.sessionId);
    res.clearCookie(SESSION_COOKIE, cookieOpts);
    return { ok: true };
  }

  @Get('me')
  async me(@Auth() a: AuthContext): Promise<Me> {
    return {
      user: { ...a.user, warehouse: env.SNOWFLAKE_WAREHOUSE },
      settings: await this.settings.get(a.user.id),
      mode: { cortexMock: env.CORTEX_MOCK, authMode: env.AUTH_MODE },
    };
  }

  @Patch('settings')
  updateSettings(@Auth() a: AuthContext, @Body() body: Partial<UserSettings>) {
    const { memoryEnabled, defaultAgentId, autoChart } = body;
    return this.settings.update(a.user.id, { memoryEnabled, defaultAgentId, autoChart });
  }
}
