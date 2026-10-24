import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '../config/env';

/**
 * Key/value cache backed by Redis when REDIS_URL is set, otherwise an
 * in-process map (fine for local dev; sessions are lost on restart).
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly log = new Logger(CacheService.name);
  readonly redis?: Redis;
  private mem = new Map<string, { value: string; expires: number }>();

  constructor() {
    if (env.REDIS_URL) {
      this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
      this.redis.on('error', (e) => this.log.error(`redis: ${e.message}`));
      this.log.log(`Using Redis at ${env.REDIS_URL}`);
    } else {
      this.log.warn('REDIS_URL not set: using in-memory cache');
    }
  }

  async get<T>(key: string): Promise<T | null> {
    let raw: string | null;
    if (this.redis) raw = await this.redis.get(key);
    else {
      const hit = this.mem.get(key);
      if (hit && hit.expires < Date.now()) this.mem.delete(key);
      raw = hit && hit.expires >= Date.now() ? hit.value : null;
    }
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const raw = JSON.stringify(value);
    if (this.redis) await this.redis.set(key, raw, 'EX', ttlSeconds);
    else this.mem.set(key, { value: raw, expires: Date.now() + ttlSeconds * 1000 });
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    if (this.redis) await this.redis.del(...keys);
    else keys.forEach((k) => this.mem.delete(k));
  }

  async wrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const value = await fn();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }
}
