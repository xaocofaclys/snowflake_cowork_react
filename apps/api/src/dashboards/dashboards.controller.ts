import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import type { DashboardItem } from '@cowork/shared';
import { Auth, type AuthContext } from '../auth/auth.types';
import { DashboardsService } from './dashboards.service';

@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get()
  list(@Auth() a: AuthContext) {
    return this.dashboards.list(a);
  }

  @Post()
  create(@Auth() a: AuthContext, @Body() b: { title?: string; description?: string; artifactIds?: string[] }) {
    return this.dashboards.create(a, b);
  }

  @Get(':id')
  get(@Auth() a: AuthContext, @Param('id') id: string) {
    return this.dashboards.get(a, id);
  }

  @Patch(':id')
  update(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { title?: string; description?: string; items?: DashboardItem[]; sharedWith?: string[] }) {
    return this.dashboards.update(a, id, b);
  }

  @Post(':id/items')
  add(@Auth() a: AuthContext, @Param('id') id: string, @Body() b: { artifactId: string }) {
    return this.dashboards.addItem(a, id, b.artifactId);
  }

  @Delete(':id')
  async remove(@Auth() a: AuthContext, @Param('id') id: string) {
    await this.dashboards.remove(a, id);
    return { ok: true };
  }
}
