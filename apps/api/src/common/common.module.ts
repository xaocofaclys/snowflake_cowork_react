import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { QueueService } from './queue.service';

@Global()
@Module({ providers: [CacheService, QueueService], exports: [CacheService, QueueService] })
export class CommonModule {}
