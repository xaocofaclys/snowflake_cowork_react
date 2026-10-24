import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Artifact, Dashboard, DashboardItem } from '@cowork/shared';
import { ArtifactsService } from '../artifacts/artifacts.service';
import type { AuthContext } from '../auth/auth.types';
import { newId, nowIso } from '../common/ids';
import { DocStore } from '../store/doc-store';

/** Dashboards: a grid of saved artifacts. Sharing follows the same rules as artifacts. */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly store: DocStore,
    private readonly artifacts: ArtifactsService,
  ) {}

  list(a: AuthContext) {
    return this.store.list<Dashboard>('DASHBOARDS', { userId: a.user.id, limit: 500 });
  }

  private canView(a: AuthContext, d: Dashboard) {
    return d.userId === a.user.id || d.sharedWith?.includes('*') || d.sharedWith?.includes(a.user.name.toUpperCase());
  }

  /** The dashboard plus the artifacts the viewer may see (others are dropped). */
  async get(a: AuthContext, id: string): Promise<{ dashboard: Dashboard; artifacts: Artifact[] }> {
    const d = await this.store.get<Dashboard>('DASHBOARDS', id);
    if (!d || !this.canView(a, d)) throw new NotFoundException('Dashboard not found');
    const artifacts = (
      await Promise.all(d.items.map((i) => this.artifacts.get(a, i.artifactId).catch(() => null)))
    ).filter((x): x is Artifact => !!x);
    return { dashboard: d, artifacts };
  }

  async create(a: AuthContext, b: { title?: string; description?: string; artifactIds?: string[] }) {
    const now = nowIso();
    const d: Dashboard = {
      id: newId('dsh'),
      userId: a.user.id,
      title: (b.title || 'Untitled dashboard').slice(0, 120),
      description: b.description,
      items: [],
      sharedWith: [],
      createdAt: now,
      updatedAt: now,
    };
    for (const id of b.artifactIds ?? []) d.items = this.place(d.items, id);
    return this.store.insert('DASHBOARDS', d);
  }

  async update(a: AuthContext, id: string, b: { title?: string; description?: string; items?: DashboardItem[]; sharedWith?: string[] }) {
    const d = await this.owned(a, id);
    if (b.items && !Array.isArray(b.items)) throw new BadRequestException('items must be an array');
    return this.store.patch<Dashboard>('DASHBOARDS', d.id, {
      ...(b.title ? { title: b.title.slice(0, 120) } : {}),
      ...(b.description !== undefined ? { description: b.description } : {}),
      ...(b.items ? { items: b.items.map(({ artifactId, x, y, w, h }) => ({ artifactId, x, y, w, h })) } : {}),
      ...(b.sharedWith ? { sharedWith: b.sharedWith.map((s) => (s === '*' ? s : s.toUpperCase())) } : {}),
    });
  }

  async addItem(a: AuthContext, id: string, artifactId: string) {
    const d = await this.owned(a, id);
    await this.artifacts.get(a, artifactId);
    if (d.items.some((i) => i.artifactId === artifactId)) return d;
    return this.store.patch<Dashboard>('DASHBOARDS', d.id, { items: this.place(d.items, artifactId) });
  }

  async remove(a: AuthContext, id: string) {
    await this.owned(a, id);
    await this.store.delete('DASHBOARDS', id);
  }

  /** New tiles go below everything else, half width, alternating left/right. */
  private place(items: DashboardItem[], artifactId: string): DashboardItem[] {
    const bottom = items.reduce((m, i) => Math.max(m, i.y + i.h), 0);
    const lastRow = items.filter((i) => i.y + i.h === bottom);
    const x = lastRow.length === 1 && lastRow[0].x === 0 && lastRow[0].w <= 6 ? 6 : 0;
    const y = x === 6 ? lastRow[0].y : bottom;
    return [...items, { artifactId, x, y, w: 6, h: 8 }];
  }

  private async owned(a: AuthContext, id: string) {
    const d = await this.store.get<Dashboard>('DASHBOARDS', id);
    if (!d) throw new NotFoundException('Dashboard not found');
    if (d.userId !== a.user.id) throw new ForbiddenException();
    return d;
  }
}
