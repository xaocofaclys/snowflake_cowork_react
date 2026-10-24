import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import type { Skill } from '@cowork/shared';
import { Auth, type AuthContext } from '../auth/auth.types';
import { newId, nowIso } from '../common/ids';
import { DocStore } from '../store/doc-store';

type SkillInput = Pick<Skill, 'name' | 'description' | 'prompt' | 'agentId'>;

/** User skills: saved, reusable prompts invoked with /name in the composer. */
@Controller('skills')
export class SkillsController {
  constructor(private readonly store: DocStore) {}

  @Get()
  list(@Auth() a: AuthContext) {
    return this.store.list<Skill>('SKILLS', { userId: a.user.id });
  }

  @Post()
  async create(@Auth() a: AuthContext, @Body() b: SkillInput) {
    const name = this.slug(b.name);
    if (!b.prompt?.trim()) throw new BadRequestException('prompt is required');
    const existing = await this.list(a);
    if (existing.some((s) => s.name === name)) throw new BadRequestException(`/${name} already exists`);
    const now = nowIso();
    return this.store.insert<Skill>('SKILLS', {
      id: newId('skl'),
      userId: a.user.id,
      name,
      description: b.description,
      prompt: b.prompt,
      agentId: b.agentId,
      createdAt: now,
      updatedAt: now,
    });
  }

  @Patch(':id')
  async update(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: Partial<SkillInput>) {
    await this.owned(a, id);
    return this.store.patch<Skill>('SKILLS', id, {
      ...(b.name ? { name: this.slug(b.name) } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.prompt ? { prompt: b.prompt } : {}),
      ...(b.agentId !== undefined ? { agentId: b.agentId } : {}),
    });
  }

  @Delete(':id')
  async remove(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.owned(a, id);
    await this.store.delete('SKILLS', id);
    return { ok: true };
  }

  private async owned(a: AuthContext, id: string) {
    const s = await this.store.get<Skill>('SKILLS', id);
    if (!s || s.userId !== a.user.id) throw new NotFoundException();
    return s;
  }

  private slug(name: string) {
    const s = (name ?? '').toLowerCase().replace(/^\//, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    if (!s) throw new BadRequestException('name is required');
    return s.slice(0, 40);
  }
}
