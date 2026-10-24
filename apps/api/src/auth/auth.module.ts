import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';
import { SettingsService } from './settings.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, SettingsService, { provide: APP_GUARD, useClass: SessionGuard }],
  exports: [AuthService, SettingsService],
})
export class AuthModule {}
