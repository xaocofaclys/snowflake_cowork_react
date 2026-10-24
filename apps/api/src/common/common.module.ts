import { Global, Module } from '@nestjs/common';
import { ActivityService } from './activity.service';
import { CacheService } from './cache.service';
import { QueueService } from './queue.service';

@Global()
@Module({ providers: [CacheService, QueueService, ActivityService], exports: [CacheService, QueueService, ActivityService] })
export class CommonModule {}
