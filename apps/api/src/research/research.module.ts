import { Global, Module } from '@nestjs/common';
import { ResearchService } from './research.service';

@Global()
@Module({ providers: [ResearchService], exports: [ResearchService] })
export class ResearchModule {}
