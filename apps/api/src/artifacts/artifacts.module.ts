import { Global, Module } from '@nestjs/common';
import { ArtifactsController } from './artifacts.controller';
import { ArtifactsService } from './artifacts.service';

@Global()
@Module({ controllers: [ArtifactsController], providers: [ArtifactsService], exports: [ArtifactsService] })
export class ArtifactsModule {}
