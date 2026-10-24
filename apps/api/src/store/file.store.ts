import { Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { BaseDoc, Collection, DocStore, ListQuery } from './doc-store';

type Row = { parentId?: string; doc: BaseDoc };

/** JSON-file store for offline development (APP_STORE=file). */
export class FileStore extends DocStore {
  private readonly log = new Logger(FileStore.name);
  private readonly path = resolve(__dirname, '../../../../.data/db.json');
  private data: Record<string, Record<string, Row>> = {};
  private timer?: NodeJS.Timeout;

  constructor() {
    super();
    if (existsSync(this.path)) this.data = JSON.parse(readFileSync(this.path, 'utf8'));
    this.log.warn(`APP_STORE=file: storing app data in ${this.path}`);
  }

  private coll(c: Collection) {
    return (this.data[c] ??= {});
  }

  private flush() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.data));
    }, 50);
  }

  async insert<T extends BaseDoc>(c: Collection, doc: T, parentId?: string) {
    this.coll(c)[doc.id] = { parentId, doc };
    this.flush();
    return doc;
  }

  async get<T extends BaseDoc>(c: Collection, id: string) {
    return (this.coll(c)[id]?.doc as T | undefined) ?? null;
  }

  async list<T extends BaseDoc>(c: Collection, q: ListQuery) {
    const rows = Object.values(this.coll(c)).filter(
      (r) => (!q.userId || r.doc.userId === q.userId) && (!q.parentId || r.parentId === q.parentId),
    );
    rows.sort((a, b) => a.doc.createdAt.localeCompare(b.doc.createdAt) * (q.order === 'asc' ? 1 : -1));
    return rows.slice(0, q.limit ?? 500).map((r) => r.doc as T);
  }

  async put<T extends BaseDoc>(c: Collection, doc: T) {
    const row = this.coll(c)[doc.id];
    this.coll(c)[doc.id] = { parentId: row?.parentId, doc };
    this.flush();
    return doc;
  }

  async delete(c: Collection, id: string) {
    delete this.coll(c)[id];
    this.flush();
  }

  async deleteByParent(c: Collection, parentId: string) {
    for (const [id, r] of Object.entries(this.coll(c))) if (r.parentId === parentId) delete this.coll(c)[id];
    this.flush();
  }
}
