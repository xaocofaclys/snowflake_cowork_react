import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Auth, type AuthContext } from '../auth/auth.types';
import { AutomationsService, type AutomationInput } from './automations.service';

@Controller('automations')
export class AutomationsController {
  constructor(private readonly automations: AutomationsService) {}

  @Get()
  list(@Auth() a: AuthContext) {
    return this.automations.list(a);
  }

  @Post()
  create(@Auth() a: AuthContext, @Body() b: Partial<AutomationInput>) {
    return this.automations.create(a, b);
  }

  @Get(':id')
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.automations.get(a, id);
  }

  @Get(':id/runs')
  runs(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.automations.runs(a, id);
  }

  @Patch(':id')
  update(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: Partial<AutomationInput>) {
    return this.automations.update(a, id, b);
  }

  @Post(':id/run')
  run(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.automations.runNow(a, id);
  }

  @Delete(':id')
  async remove(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.automations.remove(a, id);
    return { ok: true };
  }
}
