import { Controller, Get } from '@nestjs/common';
import { Auth, type AuthContext } from '../auth/auth.types';
import { CortexService } from '../cortex/cortex.service';
import { WorkflowsService } from '../workflows/workflows.service';

@Controller('agents')
export class AgentsController {
  constructor(
    private readonly cortex: CortexService,
    private readonly workflows: WorkflowsService,
  ) {}

  /** Snowflake agents plus published workflows (kind: 'workflow'), for the chat picker. */
  @Get()
  async list(@Auth() a: AuthContext) {
    const [agents, workflows] = await Promise.all([
      this.cortex.listAgents(a.cred, `${a.user.id}:${a.user.role ?? ''}`),
      this.workflows.asAgents(a),
    ]);
    return [...agents, ...workflows];
  }
}
