import { Global, Module } from '@nestjs/common';
import { ChartService } from './chart.service';

@Global()
@Module({ providers: [ChartService], exports: [ChartService] })
export class ChartsModule {}
