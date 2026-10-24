import { config as loadDotenv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

/** Monorepo root; relative paths in .env (e.g. the private key) resolve from here. */
export const REPO_ROOT = resolve(__dirname, '../../../..');

loadDotenv({ path: resolve(REPO_ROOT, '.env'), quiet: true });
loadDotenv({ quiet: true });

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  SESSION_SECRET: z.string().min(16).default('dev-only-session-secret-change-me'),

  /**
   * oauth: Snowflake OAuth per user. dev: local login without Snowflake (pairs with CORTEX_MOCK).
   * spcs: running in Snowpark Container Services; the ingress signs users in and the service
   * token at /snowflake/session/token is used to call Snowflake.
   */
  AUTH_MODE: z.enum(['oauth', 'dev', 'spcs']).default('dev'),
  /** spcs only: run agent calls and artifact refreshes with the caller's rights (experimental). */
  SPCS_CALLER_RIGHTS: bool,
  /** Injected by SPCS. */
  SNOWFLAKE_HOST: z.string().optional(),
  CORTEX_MOCK: bool,
  /** snowflake: tables in APP_DATABASE.APP_SCHEMA. file: JSON file under .data/ for offline dev. */
  APP_STORE: z.enum(['snowflake', 'file']).default('file'),
  REDIS_URL: z.string().optional(),

  SNOWFLAKE_ACCOUNT_URL: z.string().optional(),
  SNOWFLAKE_ACCOUNT: z.string().optional(),
  SNOWFLAKE_WAREHOUSE: z.string().default('COWORK_WH'),
  SNOWFLAKE_ROLE: z.string().default('COWORK_USER'),
  OAUTH_CLIENT_ID: z.string().optional(),
  OAUTH_CLIENT_SECRET: z.string().optional(),
  OAUTH_REDIRECT_URI: z.string().default('http://localhost:4000/auth/callback'),

  /** Service identity for app-metadata storage and background jobs. PAT or key-pair. */
  SNOWFLAKE_SERVICE_USER: z.string().optional(),
  SNOWFLAKE_SERVICE_PAT: z.string().optional(),
  SNOWFLAKE_SERVICE_PRIVATE_KEY_PATH: z.string().optional(),
  SNOWFLAKE_SERVICE_ROLE: z.string().default('COWORK_APP_SERVICE'),

  APP_DATABASE: z.string().default('COWORK_APP'),
  APP_SCHEMA: z.string().default('CORE'),
  /** Comma-separated DB.SCHEMA list to discover agents in. Empty = SHOW AGENTS IN ACCOUNT. */
  AGENT_LOCATIONS: z.string().default(''),

  /** Snowflake role required to build workflows. Empty = everyone can build. */
  WORKFLOW_BUILDER_ROLE: z.string().default(''),

  LLM_MODEL: z.string().default('llama3.1-70b'),
  /** Deep research planning and report writing. */
  RESEARCH_MODEL: z.string().default('claude-sonnet-4-5'),
  /** Public URL of the app, used for links in automation emails. */
  APP_PUBLIC_URL: z.string().optional(),
  /** Snowflake notification integration (TYPE=EMAIL) used by SYSTEM$SEND_EMAIL. */
  EMAIL_INTEGRATION: z.string().default('COWORK_EMAIL'),
  EMBED_MODEL: z.string().default('snowflake-arctic-embed-m-v1.5'),
  ARTIFACT_CACHE_TTL: z.coerce.number().default(300),
});

export type Env = z.infer<typeof schema>;

export const env: Env = (() => {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  const e = parsed.data;
  if (e.AUTH_MODE === 'oauth' && (!e.SNOWFLAKE_ACCOUNT_URL || !e.OAUTH_CLIENT_ID || !e.OAUTH_CLIENT_SECRET)) {
    console.error('AUTH_MODE=oauth requires SNOWFLAKE_ACCOUNT_URL, OAUTH_CLIENT_ID and OAUTH_CLIENT_SECRET');
    process.exit(1);
  }
  if (e.AUTH_MODE === 'spcs') {
    if (!e.SNOWFLAKE_HOST) {
      console.error('AUTH_MODE=spcs requires SNOWFLAKE_HOST (set automatically inside SPCS)');
      process.exit(1);
    }
    e.SNOWFLAKE_ACCOUNT_URL = `https://${e.SNOWFLAKE_HOST}`;
  } else if (e.APP_STORE === 'snowflake' && !e.SNOWFLAKE_SERVICE_PAT && !e.SNOWFLAKE_SERVICE_PRIVATE_KEY_PATH) {
    console.error('APP_STORE=snowflake requires SNOWFLAKE_SERVICE_PAT or SNOWFLAKE_SERVICE_PRIVATE_KEY_PATH');
    process.exit(1);
  }
  return e;
})();
