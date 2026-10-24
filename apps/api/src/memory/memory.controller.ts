import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import type { MemoryCategory } from '@cowork/shared';
import { Auth, type AuthContext } from '../auth/auth.types';
import { MemoryService } from './memory.service';

@Controller('memories')
export class MemoryController {
  constructor(private readonly memory: MemoryService) {}

  @Get()
  list(@Auth() a: AuthContext) {
    return this.memory.listPublic(a.user.id);
  }

  @Post()
  create(@Auth() a: AuthContext, @Body() b: { text: string; category?: MemoryCategory }) {
    return this.memory.create(a.user.id, b.text, b.category ?? 'fact', 'manual', a.cred);
  }

  @Patch(':id')
  update(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { text?: string; category?: MemoryCategory }) {
    return this.memory.update(a.user.id, id, b, a.cred);
  }

  @Delete(':id')
  async remove(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.memory.remove(a.user.id, id);
    return { ok: true };
  }

  @Delete()
  async clear(@Auth() a: AuthContext) {
    await this.memory.clear(a.user.id);
    return { ok: true };
  }
}
