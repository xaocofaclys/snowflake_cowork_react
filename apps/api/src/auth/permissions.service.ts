import { Injectable, Logger } from '@nestjs/common';
import type { Permissions, User } from '@cowork/shared';
import { CacheService } from '../common/cache.service';
import { env } from '../config/env';
import { SnowflakeClient } from '../snowflake/snowflake.client';

const SAFE_ROLE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * App permissions backed by Snowflake roles. With WORKFLOW_BUILDER_ROLE empty everyone can
 * build; set it (e.g. COWORK_BUILDER) and only users granted that role directly can.
 */
@Injectable()
export class PermissionsService {
  private readonly log = new Logger(PermissionsService.name);

  constructor(
    private readonly cache: CacheService,
    private readonly sf: SnowflakeClient,
  ) {}

  async forUser(user: User): Promise<Permissions> {
    return { buildWorkflows: await this.hasRole(user, env.WORKFLOW_BUILDER_ROLE) };
  }

  private async hasRole(user: User, role: string): Promise<boolean> {
    if (!role) return true;
    if (!SAFE_ROLE.test(role) || !this.sf.hasServiceCredential()) return false;
    const members = await this.cache.wrap(`role_members:${role}`, 300, async () => {
      try {
        const r = await this.sf.sql(`SHOW GRANTS OF ROLE ${role}`, [], this.sf.serviceCredential());
        const col = (n: string) => r.columns.findIndex((c) => c.name.toLowerCase() === n);
        return r.rows.filter((row) => String(row[col('granted_to')]) === 'USER').map((row) => String(row[col('grantee_name')]).toUpperCase());
      } catch (e) {
        this.log.warn(`Could not read members of ${role}: ${(e as Error).message}`);
        return [];
      }
    });
    return members.includes(user.name.toUpperCase());
  }
}
