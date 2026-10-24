import { Global, Module } from '@nestjs/common';
import { DashboardBuilderService } from './dashboard-builder.service';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

@Global()
@Module({ controllers: [DashboardsController], providers: [DashboardsService, DashboardBuilderService], exports: [DashboardBuilderService] })
export class DashboardsModule {}
