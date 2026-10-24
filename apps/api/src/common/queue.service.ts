import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { env } from '../config/env';

type Handler = (data: any) => Promise<void>;

/**
 * Background jobs (memory extraction, thread titles, later automations).
 * Uses BullMQ when Redis is configured, otherwise runs jobs in-process.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly log = new Logger(QueueService.name);
  private handlers = new Map<string, Handler>();
  private queue?: Queue;
  private worker?: Worker;

  constructor() {
    if (env.REDIS_URL) {
      const connection = { url: env.REDIS_URL };
      this.queue = new Queue('cowork', { connection });
      this.worker = new Worker(
        'cowork',
        async (job) => {
          const h = this.handlers.get(job.name);
          if (!h) throw new Error(`No handler for job ${job.name}`);
          await h(job.data);
        },
        { connection, concurrency: 4 },
      );
      this.worker.on('failed', (job, err) => this.log.error(`job ${job?.name} failed: ${err.message}`));
    }
  }

  register(name: string, handler: Handler) {
    this.handlers.set(name, handler);
  }

  async enqueue(name: string, data: unknown) {
    if (this.queue) {
      await this.queue.add(name, data, { removeOnComplete: 100, removeOnFail: 500, attempts: 2 });
      return;
    }
    const h = this.handlers.get(name);
    if (!h) return;
    setImmediate(() => h(data).catch((e) => this.log.error(`job ${name} failed: ${e.message}`)));
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }
}
