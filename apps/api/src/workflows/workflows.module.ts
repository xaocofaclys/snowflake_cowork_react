import { Global, Module } from '@nestjs/common';
import { WorkflowExecutor } from './workflow-executor';
import { WorkflowsController } from './workflows.controller';
import { WorkflowsService } from './workflows.service';

@Global()
@Module({ controllers: [WorkflowsController], providers: [WorkflowExecutor, WorkflowsService], exports: [WorkflowsService] })
export class WorkflowsModule {}
