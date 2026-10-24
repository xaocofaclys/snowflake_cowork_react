import { Injectable, Logger } from '@nestjs/common';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TableData } from '@cowork/shared';
import { env, REPO_ROOT } from '../config/env';

/** Mounted by SPCS; overridable only to exercise spcs mode outside a container. */
export const SPCS_TOKEN_PATH = process.env.SPCS_TOKEN_PATH ?? '/snowflake/session/token';

export type TokenType = 'OAUTH' | 'PROGRAMMATIC_ACCESS_TOKEN' | 'KEYPAIR_JWT';

/** Who a Snowflake call runs as: the signed-in user (OAuth) or the app's service user. */
export interface SfCredential {
  token: string;
  tokenType: TokenType;
  role?: string;
}

export interface SqlOptions {
  database?: string;
  schema?: string;
  warehouse?: string;
  role?: string;
  timeoutSeconds?: number;
}

export interface SqlResult extends TableData {
  queryId: string;
}

export class SnowflakeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

type Binding = { type: string; value: string | null };

/**
 * Thin client over Snowflake's REST surface: the SQL API (/api/v2/statements)
 * for queries and the Cortex REST endpoints. Uses fetch only, no native driver,
 * so it runs the same locally and inside SPCS.
 */
@Injectable()
export class SnowflakeClient {
  private readonly log = new Logger(SnowflakeClient.name);
  private jwt?: { token: string; exp: number };
  private spcsSessionStyle = false;

  get baseUrl(): string {
    if (!env.SNOWFLAKE_ACCOUNT_URL) throw new Error('SNOWFLAKE_ACCOUNT_URL is not configured');
    return env.SNOWFLAKE_ACCOUNT_URL.replace(/\/$/, '');
  }

  headers(cred: SfCredential, accept = 'application/json', sessionStyle = false): Record<string, string> {
    return {
      ...(sessionStyle
        ? { Authorization: `Snowflake Token="${cred.token}"` }
        : { Authorization: `Bearer ${cred.token}`, 'X-Snowflake-Authorization-Token-Type': cred.tokenType }),
      'Content-Type': 'application/json',
      Accept: accept,
      'User-Agent': 'cowork-clone/0.1',
    };
  }

  /** Raw fetch against the account, for streaming endpoints (agent:run). */
  async request(path: string, cred: SfCredential, init: RequestInit & { accept?: string } = {}): Promise<Response> {
    const send = (sessionStyle: boolean) =>
      fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { ...this.headers(cred, init.accept, sessionStyle), ...(init.headers as Record<string, string>) },
      });
    let res = await send(this.spcsSessionStyle);
    // Inside SPCS, fall back to the session-token header format if the OAuth bearer format is rejected.
    if (res.status === 401 && env.AUTH_MODE === 'spcs' && !this.spcsSessionStyle) {
      const retry = await send(true);
      if (retry.ok) {
        this.log.warn('SPCS token accepted only in "Snowflake Token" format; using it from now on');
        this.spcsSessionStyle = true;
      }
      res = retry;
    }
    if (!res.ok) {
      const body = await res.text();
      let message = body;
      let code: string | undefined;
      try {
        const j = JSON.parse(body);
        message = j.message ?? body;
        code = j.code;
      } catch {
        /* not JSON */
      }
      throw new SnowflakeApiError(`Snowflake ${res.status} on ${path}: ${message}`, res.status, code);
    }
    return res;
  }

  async json<T>(path: string, cred: SfCredential, init: RequestInit = {}): Promise<T> {
    const res = await this.request(path, cred, init);
    return (await res.json()) as T;
  }

  /** Runs one SQL statement via the SQL API. `?` placeholders bind positionally. */
  async sql(statement: string, binds: unknown[], cred: SfCredential, opts: SqlOptions = {}): Promise<SqlResult> {
    const bindings: Record<string, Binding> = {};
    binds.forEach((v, i) => (bindings[String(i + 1)] = toBinding(v)));
    const body = {
      statement,
      timeout: opts.timeoutSeconds ?? 120,
      warehouse: opts.warehouse ?? env.SNOWFLAKE_WAREHOUSE,
      ...(opts.database ? { database: opts.database } : {}),
      ...(opts.schema ? { schema: opts.schema } : {}),
      ...(opts.role ?? cred.role ? { role: opts.role ?? cred.role } : {}),
      ...(binds.length ? { bindings } : {}),
    };
    let res = await this.request('/api/v2/statements?nullable=true', cred, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    let payload = (await res.json()) as any;
    // 202: still running; poll the statement handle.
    while (res.status === 202) {
      await new Promise((r) => setTimeout(r, 500));
      res = await this.request(`/api/v2/statements/${payload.statementHandle}`, cred);
      payload = await res.json();
    }
    const meta = payload.resultSetMetaData ?? {};
    const columns = (meta.rowType ?? []).map((c: any) => ({ name: c.name, type: String(c.type).toLowerCase() }));
    const rows: unknown[][] = [...(payload.data ?? [])];
    const partitions: unknown[] = meta.partitionInfo ?? [];
    for (let p = 1; p < partitions.length; p++) {
      const part = await this.json<any>(`/api/v2/statements/${payload.statementHandle}?partition=${p}`, cred);
      rows.push(...(part.data ?? []));
    }
    return { queryId: payload.statementHandle, columns, rows: rows.map((r) => coerceRow(r, columns)) };
  }

  /** Credential for the app's service user (metadata storage, background jobs). */
  serviceCredential(): SfCredential {
    if (env.AUTH_MODE === 'spcs') {
      // Refreshed by Snowflake every few minutes; always read the current one. Runs as the service owner role.
      return { token: readFileSync(SPCS_TOKEN_PATH, 'utf8').trim(), tokenType: 'OAUTH' };
    }
    if (env.SNOWFLAKE_SERVICE_PAT) {
      return { token: env.SNOWFLAKE_SERVICE_PAT, tokenType: 'PROGRAMMATIC_ACCESS_TOKEN', role: env.SNOWFLAKE_SERVICE_ROLE };
    }
    if (env.SNOWFLAKE_SERVICE_PRIVATE_KEY_PATH) {
      return { token: this.keyPairJwt(), tokenType: 'KEYPAIR_JWT', role: env.SNOWFLAKE_SERVICE_ROLE };
    }
    throw new Error('No Snowflake service credential configured');
  }

  hasServiceCredential(): boolean {
    return env.AUTH_MODE === 'spcs' || Boolean(env.SNOWFLAKE_SERVICE_PAT || env.SNOWFLAKE_SERVICE_PRIVATE_KEY_PATH);
  }

  private keyPairJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    if (this.jwt && this.jwt.exp - 60 > now) return this.jwt.token;
    const account = (env.SNOWFLAKE_ACCOUNT ?? '').toUpperCase();
    const user = (env.SNOWFLAKE_SERVICE_USER ?? '').toUpperCase();
    if (!account || !user) throw new Error('Key-pair auth needs SNOWFLAKE_ACCOUNT and SNOWFLAKE_SERVICE_USER');
    const key = createPrivateKey(readFileSync(resolve(REPO_ROOT, env.SNOWFLAKE_SERVICE_PRIVATE_KEY_PATH!)));
    const pubDer = createPublicKey(key).export({ type: 'spki', format: 'der' });
    const fp = 'SHA256:' + createHash('sha256').update(pubDer).digest('base64');
    const exp = now + 3540;
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: `${account}.${user}.${fp}`,
      sub: `${account}.${user}`,
      iat: now,
      exp,
    })}`;
    const sig = sign('RSA-SHA256', Buffer.from(unsigned), key).toString('base64url');
    this.jwt = { token: `${unsigned}.${sig}`, exp };
    return this.jwt.token;
  }
}

function toBinding(v: unknown): Binding {
  if (v === null || v === undefined) return { type: 'TEXT', value: null };
  if (typeof v === 'number') return { type: Number.isInteger(v) ? 'FIXED' : 'REAL', value: String(v) };
  if (typeof v === 'boolean') return { type: 'BOOLEAN', value: String(v) };
  if (typeof v === 'object') return { type: 'TEXT', value: JSON.stringify(v) };
  return { type: 'TEXT', value: String(v) };
}

/** The SQL API returns every value as a string; restore numbers and booleans. */
function coerceRow(row: unknown[], columns: { type: string }[]): unknown[] {
  return row.map((v, i) => {
    if (v === null || v === undefined) return null;
    const t = columns[i]?.type;
    if (t === 'fixed' || t === 'real') return Number(v);
    if (t === 'boolean') return v === 'true' || v === true;
    if (t === 'date' && /^\d+$/.test(String(v))) {
      return new Date(Number(v) * 86400000).toISOString().slice(0, 10);
    }
    if (t?.startsWith('timestamp') && /^\d+(\.\d+)?( \d+)?$/.test(String(v))) {
      return new Date(Number(String(v).split(' ')[0]) * 1000).toISOString();
    }
    return v;
  });
}
