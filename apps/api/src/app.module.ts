import { Module } from '@nestjs/common';
import { AgentsModule } from './agents/agents.module';
import { ArtifactsModule } from './artifacts/artifacts.module';
import { AuthModule } from './auth/auth.module';
import { ChartsModule } from './charts/charts.module';
import { ChatModule } from './chat/chat.module';
import { CommonModule } from './common/common.module';
import { CortexModule } from './cortex/cortex.module';
import { LlmModule } from './llm/llm.module';
import { MemoryModule } from './memory/memory.module';
import { SkillsModule } from './skills/skills.module';
import { StoreModule } from './store/store.module';
import { HealthController } from './health.controller';
import { WorkflowsModule } from './workflows/workflows.module';

@Module({
  imports: [
    CommonModule,
    StoreModule,
    LlmModule,
    CortexModule,
    ChartsModule,
    AuthModule,
    AgentsModule,
    ChatModule,
    ArtifactsModule,
    MemoryModule,
    SkillsModule,
    WorkflowsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
