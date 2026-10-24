import { Body, Controller, Delete, Get, Param, Patch, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { WorkflowGraph } from '@cowork/shared';
import { Auth, type AuthContext } from '../auth/auth.types';
import { WorkflowsService, type WorkflowInput } from './workflows.service';

@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Get()
  list(@Auth() a: AuthContext) {
    return this.workflows.list(a);
  }

  @Post()
  create(@Auth() a: AuthContext, @Body() b: Partial<WorkflowInput>) {
    return this.workflows.create(a, b);
  }

  /** Test-run a draft graph; streams SSE (node_start / node_event / node_end / text / done). */
  @Post('run')
  run(@Auth() a: AuthContext, @Body() b: { graph: WorkflowGraph; input: string; maxSteps?: number }, @Res() res: Response) {
    return this.workflows.streamDraft(a, b, res);
  }

  @Get(':id')
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.workflows.get(a, id);
  }

  @Patch(':id')
  update(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: Partial<WorkflowInput>) {
    return this.workflows.update(a, id, b);
  }

  @Delete(':id')
  async remove(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.workflows.remove(a, id);
    return { ok: true };
  }
}
