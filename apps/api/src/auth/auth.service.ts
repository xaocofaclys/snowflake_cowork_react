import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { User } from '@cowork/shared';
import { CacheService } from '../common/cache.service';
import { decrypt, encrypt } from '../common/crypto';
import { nowIso } from '../common/ids';
import { env } from '../config/env';
import { SfCredential, SnowflakeClient } from '../snowflake/snowflake.client';
import { DocStore } from '../store/doc-store';
import type { AuthContext, Session } from './auth.types';

const SESSION_TTL = 60 * 60 * 24 * 7;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  username?: string;
  scope?: string;
}

/**
 * Snowflake OAuth (custom client, authorization-code flow). Each user's
 * queries and agent runs use their own access token, so Snowflake RBAC
 * applies exactly as in CoWork.
 */
@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly store: DocStore,
    private readonly sf: SnowflakeClient,
  ) {}

  async authorizeUrl(): Promise<string> {
    const state = randomBytes(16).toString('base64url');
    await this.cache.set(`oauth_state:${state}`, 1, 600);
    const q = new URLSearchParams({
      client_id: env.OAUTH_CLIENT_ID!,
      response_type: 'code',
      redirect_uri: env.OAUTH_REDIRECT_URI,
      state,
      scope: `refresh_token session:role:${env.SNOWFLAKE_ROLE}`,
    });
    return `${this.sf.baseUrl}/oauth/authorize?${q}`;
  }

  async handleCallback(code: string, state: string): Promise<string> {
    if (!(await this.cache.get(`oauth_state:${state}`))) throw new UnauthorizedException('Invalid OAuth state');
    await this.cache.del(`oauth_state:${state}`);
    const tok = await this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: env.OAUTH_REDIRECT_URI,
    });
    const username = tok.username ?? (await this.currentUser(tok.access_token));
    const user = await this.upsertUser(username, env.SNOWFLAKE_ROLE);
    return this.createSession({
      user,
      accessToken: tok.access_token,
      accessExpiresAt: Date.now() + tok.expires_in * 1000,
      refreshTokenEnc: tok.refresh_token ? encrypt(tok.refresh_token) : undefined,
    });
  }

  async devLogin(name: string): Promise<string> {
    const user = await this.upsertUser(name || 'demo', 'COWORK_USER');
    return this.createSession({ user });
  }

  /**
   * Resolves the caller from the session cookie, or in SPCS from the headers the
   * ingress adds after it has signed the user in to Snowflake.
   */
  async resolve(sessionId: string | undefined, headers: Record<string, string | string[] | undefined> = {}): Promise<AuthContext | null> {
    if (env.AUTH_MODE === 'spcs') return this.resolveSpcs(headers);
    if (!sessionId) return null;
    const s = await this.cache.get<Session>(`sess:${sessionId}`);
    if (!s) return null;
    if (env.AUTH_MODE === 'dev') {
      const cred = this.sf.hasServiceCredential() ? this.sf.serviceCredential() : undefined;
      return { user: s.user, cred, sessionId };
    }
    if (!s.accessToken || (s.accessExpiresAt ?? 0) - 60_000 < Date.now()) {
      if (!s.refreshTokenEnc) return null;
      try {
        const tok = await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(s.refreshTokenEnc) });
        s.accessToken = tok.access_token;
        s.accessExpiresAt = Date.now() + tok.expires_in * 1000;
        await this.cache.set(`sess:${sessionId}`, s, SESSION_TTL);
      } catch (e) {
        this.log.warn(`token refresh failed: ${(e as Error).message}`);
        return null;
      }
    }
    const cred: SfCredential = { token: s.accessToken!, tokenType: 'OAUTH' };
    return { user: s.user, cred, sessionId };
  }

  private async resolveSpcs(headers: Record<string, string | string[] | undefined>): Promise<AuthContext | null> {
    const username = headers['sf-context-current-user'];
    if (typeof username !== 'string' || !username) return null;
    const user = await this.cache.wrap(`spcs_user:${username}`, 600, () => this.upsertUser(username, env.SNOWFLAKE_ROLE));
    const serviceCred = this.sf.serviceCredential();
    const callerToken = headers['sf-context-current-user-token'];
    // Caller's rights: "<service token>.<caller token>" runs as the signed-in user (needs executeAsCaller + CALLER grants).
    const cred: SfCredential =
      env.SPCS_CALLER_RIGHTS && typeof callerToken === 'string' && callerToken
        ? { token: `${serviceCred.token}.${callerToken}`, tokenType: 'OAUTH' }
        : serviceCred;
    return { user, cred, sessionId: `spcs:${username}` };
  }

  async logout(sessionId: string) {
    await this.cache.del(`sess:${sessionId}`);
  }

  private async createSession(s: Session): Promise<string> {
    const id = randomBytes(24).toString('base64url');
    await this.cache.set(`sess:${id}`, s, SESSION_TTL);
    return id;
  }

  private async upsertUser(username: string, role: string): Promise<User> {
    const id = `u_${username.toLowerCase().replace(/[^a-z0-9_]/g, '_')}`;
    const existing = await this.store.get<User & { userId: string; createdAt: string; updatedAt: string }>('USERS', id);
    if (existing) return { id, name: existing.name, displayName: existing.displayName, role };
    const now = nowIso();
    await this.store.insert('USERS', { id, userId: id, name: username, role, createdAt: now, updatedAt: now });
    return { id, name: username, role };
  }

  private async tokenRequest(form: Record<string, string>): Promise<TokenResponse> {
    const basic = Buffer.from(`${env.OAUTH_CLIENT_ID}:${env.OAUTH_CLIENT_SECRET}`).toString('base64');
    const res = await fetch(`${this.sf.baseUrl}/oauth/token-request`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form),
    });
    if (!res.ok) throw new UnauthorizedException(`OAuth token request failed: ${await res.text()}`);
    return (await res.json()) as TokenResponse;
  }

  private async currentUser(accessToken: string): Promise<string> {
    const r = await this.sf.sql('SELECT CURRENT_USER()', [], { token: accessToken, tokenType: 'OAUTH' });
    return String(r.rows[0][0]);
  }
}
