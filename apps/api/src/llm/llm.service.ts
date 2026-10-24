import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { SfCredential, SnowflakeClient } from '../snowflake/snowflake.client';

const SAFE_MODEL = /^[a-z0-9._-]+$/i;

/**
 * Cortex LLM functions for app features around the agent (memory extraction,
 * chart fallback, titles). Returns null when unavailable (mock mode, no
 * credential, or a failure), so every caller has a non-LLM fallback.
 */
@Injectable()
export class LlmService {
  private readonly log = new Logger(LlmService.name);

  constructor(private readonly sf: SnowflakeClient) {}

  get enabled(): boolean {
    return !env.CORTEX_MOCK;
  }

  private cred(user?: SfCredential): SfCredential | undefined {
    return this.sf.hasServiceCredential() ? this.sf.serviceCredential() : user;
  }

  async complete(prompt: string, user?: SfCredential): Promise<string | null> {
    const cred = this.cred(user);
    if (!this.enabled || !cred || !SAFE_MODEL.test(env.LLM_MODEL)) return null;
    try {
      const r = await this.sf.sql(`SELECT SNOWFLAKE.CORTEX.COMPLETE('${env.LLM_MODEL}', ?)`, [prompt], cred);
      return String(r.rows[0]?.[0] ?? '');
    } catch (e) {
      this.log.warn(`COMPLETE failed: ${(e as Error).message}`);
      return null;
    }
  }

  /** Parses the first JSON object/array in a completion. */
  async completeJson<T>(prompt: string, user?: SfCredential): Promise<T | null> {
    const out = await this.complete(prompt, user);
    if (!out) return null;
    const m = out.match(/[[{][\s\S]*[\]}]/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return null;
    }
  }

  async embed(text: string, user?: SfCredential): Promise<number[] | null> {
    const cred = this.cred(user);
    if (!this.enabled || !cred || !SAFE_MODEL.test(env.EMBED_MODEL)) return null;
    try {
      const r = await this.sf.sql(`SELECT SNOWFLAKE.CORTEX.EMBED_TEXT_768('${env.EMBED_MODEL}', ?)`, [text], cred);
      const v = r.rows[0]?.[0];
      return typeof v === 'string' ? JSON.parse(v) : (v as number[]);
    } catch (e) {
      this.log.warn(`EMBED failed: ${(e as Error).message}`);
      return null;
    }
  }
}
