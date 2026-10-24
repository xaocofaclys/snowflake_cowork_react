/**
 * App metadata is stored as JSON documents, one table per collection:
 *   (ID, USER_ID, PARENT_ID, DATA VARIANT, CREATED_AT, UPDATED_AT)
 * USER_ID and PARENT_ID are real columns so ownership and parent lookups
 * (messages of a thread) are cheap; everything else lives in DATA.
 */
export const COLLECTIONS = [
  'USERS',
  'THREADS',
  'MESSAGES',
  'ARTIFACTS',
  'MEMORIES',
  'SKILLS',
  'SETTINGS',
] as const;
export type Collection = (typeof COLLECTIONS)[number];

export interface BaseDoc {
  id: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListQuery {
  userId?: string;
  parentId?: string;
  limit?: number;
  order?: 'asc' | 'desc';
}

export abstract class DocStore {
  abstract insert<T extends BaseDoc>(coll: Collection, doc: T, parentId?: string): Promise<T>;
  abstract get<T extends BaseDoc>(coll: Collection, id: string): Promise<T | null>;
  abstract list<T extends BaseDoc>(coll: Collection, q: ListQuery): Promise<T[]>;
  /** Replaces the document's data (read-modify-write is done by callers via patch()). */
  abstract put<T extends BaseDoc>(coll: Collection, doc: T): Promise<T>;
  abstract delete(coll: Collection, id: string): Promise<void>;
  abstract deleteByParent(coll: Collection, parentId: string): Promise<void>;

  async patch<T extends BaseDoc>(coll: Collection, id: string, patch: Partial<T>): Promise<T | null> {
    const cur = await this.get<T>(coll, id);
    if (!cur) return null;
    return this.put(coll, { ...cur, ...patch, id: cur.id, userId: cur.userId, updatedAt: new Date().toISOString() });
  }
}
