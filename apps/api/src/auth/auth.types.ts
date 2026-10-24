import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '@cowork/shared';
import type { SfCredential } from '../snowflake/snowflake.client';

export interface Session {
  user: User;
  accessToken?: string;
  accessExpiresAt?: number;
  refreshTokenEnc?: string;
}

/** Attached to each authenticated request by SessionGuard. */
export interface AuthContext {
  user: User;
  /** Credential to call Snowflake as this user. Undefined in dev mode without a service identity. */
  cred?: SfCredential;
  sessionId: string;
}

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  return ctx.switchToHttp().getRequest().auth;
});
