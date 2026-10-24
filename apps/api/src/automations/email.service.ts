import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { SnowflakeClient } from '../snowflake/snowflake.client';

const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/**
 * Email through Snowflake's SYSTEM$SEND_EMAIL and the EMAIL_INTEGRATION notification integration.
 * Snowflake only delivers to verified email addresses of users in this account.
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);

  constructor(private readonly sf: SnowflakeClient) {}

  static validRecipients(to: string[]): string[] {
    return to.map((t) => t.trim()).filter((t) => EMAIL.test(t));
  }

  async send(to: string[], subject: string, html: string): Promise<void> {
    const recipients = EmailService.validRecipients(to);
    if (!recipients.length) throw new Error('No valid email recipients');
    if (env.CORTEX_MOCK || !this.sf.hasServiceCredential()) {
      this.log.log(`[mock email] to=${recipients.join(',')} subject="${subject}" (${html.length} chars)`);
      return;
    }
    if (!SAFE_IDENT.test(env.EMAIL_INTEGRATION)) throw new Error('Invalid EMAIL_INTEGRATION');
    await this.sf.sql(
      `CALL SYSTEM$SEND_EMAIL('${env.EMAIL_INTEGRATION}', ?, ?, ?, 'text/html')`,
      [recipients.join(','), subject.slice(0, 250), html],
      this.sf.serviceCredential(),
    );
  }
}
