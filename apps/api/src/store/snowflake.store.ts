import { Logger } from '@nestjs/common';
import { env } from '../config/env';
import { SnowflakeClient } from '../snowflake/snowflake.client';
import { BaseDoc, Collection, COLLECTIONS, DocStore, ListQuery } from './doc-store';

/** Stores app metadata in Snowflake tables (APP_STORE=snowflake), as the service user. */
export class SnowflakeStore extends DocStore {
  private readonly log = new Logger(SnowflakeStore.name);

  constructor(private readonly sf: SnowflakeClient) {
    super();
  }

  private t(c: Collection) {
    return `${env.APP_DATABASE}.${env.APP_SCHEMA}.${c}`;
  }

  private run(sql: string, binds: unknown[] = []) {
    return this.sf.sql(sql, binds, this.sf.serviceCredential());
  }

  /** Idempotent: creates the collection tables if they're missing. */
  async ensureSchema() {
    for (const c of COLLECTIONS) {
      await this.run(
        `CREATE TABLE IF NOT EXISTS ${this.t(c)} (
           ID STRING PRIMARY KEY, USER_ID STRING, PARENT_ID STRING, DATA VARIANT,
           CREATED_AT TIMESTAMP_NTZ DEFAULT SYSDATE(), UPDATED_AT TIMESTAMP_NTZ DEFAULT SYSDATE())`,
      );
    }
    this.log.log(`App schema ready in ${env.APP_DATABASE}.${env.APP_SCHEMA}`);
  }

  async insert<T extends BaseDoc>(c: Collection, doc: T, parentId?: string) {
    await this.run(
      `INSERT INTO ${this.t(c)} (ID, USER_ID, PARENT_ID, DATA, CREATED_AT, UPDATED_AT)
       SELECT ?, ?, ?, PARSE_JSON(?), ?::TIMESTAMP_NTZ, ?::TIMESTAMP_NTZ`,
      [doc.id, doc.userId, parentId ?? null, JSON.stringify(doc), doc.createdAt, doc.updatedAt],
    );
    return doc;
  }

  async get<T extends BaseDoc>(c: Collection, id: string) {
    const r = await this.run(`SELECT DATA FROM ${this.t(c)} WHERE ID = ?`, [id]);
    return r.rows[0] ? (JSON.parse(String(r.rows[0][0])) as T) : null;
  }

  async list<T extends BaseDoc>(c: Collection, q: ListQuery) {
    const where: string[] = [];
    const binds: unknown[] = [];
    if (q.userId) (where.push('USER_ID = ?'), binds.push(q.userId));
    if (q.parentId) (where.push('PARENT_ID = ?'), binds.push(q.parentId));
    const r = await this.run(
      `SELECT DATA FROM ${this.t(c)} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY CREATED_AT ${q.order === 'asc' ? 'ASC' : 'DESC'} LIMIT ${Math.min(q.limit ?? 500, 5000)}`,
      binds,
    );
    return r.rows.map((row) => JSON.parse(String(row[0])) as T);
  }

  async put<T extends BaseDoc>(c: Collection, doc: T) {
    await this.run(`UPDATE ${this.t(c)} SET DATA = PARSE_JSON(?), UPDATED_AT = ?::TIMESTAMP_NTZ WHERE ID = ?`, [
      JSON.stringify(doc),
      doc.updatedAt,
      doc.id,
    ]);
    return doc;
  }

  async delete(c: Collection, id: string) {
    await this.run(`DELETE FROM ${this.t(c)} WHERE ID = ?`, [id]);
  }

  async deleteByParent(c: Collection, parentId: string) {
    await this.run(`DELETE FROM ${this.t(c)} WHERE PARENT_ID = ?`, [parentId]);
  }
}
