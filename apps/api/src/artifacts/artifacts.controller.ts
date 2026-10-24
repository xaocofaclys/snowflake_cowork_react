import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Auth, type AuthContext } from '../auth/auth.types';
import { ArtifactsService, type CreateArtifact } from './artifacts.service';

@Controller('artifacts')
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get()
  list(@Auth() a: AuthContext) {
    return this.artifacts.list(a.user.id);
  }

  @Post()
  create(@Auth() a: AuthContext, @Body() b: CreateArtifact) {
    return this.artifacts.create(a, b);
  }

  @Get(':id')
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.artifacts.get(a, id);
  }

  @Patch(':id')
  update(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { title?: string; description?: string; sharedWith?: string[] }) {
    return this.artifacts.update(a, id, b);
  }

  @Delete(':id')
  async remove(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.artifacts.remove(a, id);
    return { ok: true };
  }

  @Post(':id/refresh')
  refresh(@Auth() a: AuthContext, @Param('id') id: string, @Query('force') force?: string) {
    return this.artifacts.refresh(a, id, force === 'true');
  }
}
