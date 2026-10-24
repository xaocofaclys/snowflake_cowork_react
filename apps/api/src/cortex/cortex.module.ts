import { Global, Module } from '@nestjs/common';
import { AgentRouter } from './agent-router';
import { CortexService } from './cortex.service';

@Global()
@Module({ providers: [CortexService, AgentRouter], exports: [CortexService, AgentRouter] })
export class CortexModule {}
