import { Global, Module } from '@nestjs/common';
import { CortexService } from './cortex.service';

@Global()
@Module({ providers: [CortexService], exports: [CortexService] })
export class CortexModule {}
