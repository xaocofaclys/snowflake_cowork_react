import { Controller, Get } from '@nestjs/common';
import { Auth, type AuthContext } from '../auth/auth.types';
import { CortexService } from '../cortex/cortex.service';

@Controller('agents')
export class AgentsController {
  constructor(private readonly cortex: CortexService) {}

  @Get()
  list(@Auth() a: AuthContext) {
    return this.cortex.listAgents(a.cred, `${a.user.id}:${a.user.role ?? ''}`);
  }
}
