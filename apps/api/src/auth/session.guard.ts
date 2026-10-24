import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SetMetadata } from '@nestjs/common';
import { ActivityService } from '../common/activity.service';
import { AuthService } from './auth.service';

export const SESSION_COOKIE = 'cw_sid';
export const Public = () => SetMetadata('public', true);

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly auth: AuthService,
    private readonly reflector: Reflector,
    private readonly activity: ActivityService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>('public', [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const auth = await this.auth.resolve(req.cookies?.[SESSION_COOKIE], req.headers);
    if (!auth) throw new UnauthorizedException();
    req.auth = auth;
    this.activity.touch();
    return true;
  }
}
