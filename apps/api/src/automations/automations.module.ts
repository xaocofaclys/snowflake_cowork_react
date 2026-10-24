import { Global, Module } from '@nestjs/common';
import { AutomationIntentService } from './automation-intent';
import { AutomationRunner } from './automation-runner';
import { AutomationsController } from './automations.controller';
import { AutomationScheduler } from './automations.scheduler';
import { AutomationsService } from './automations.service';
import { EmailService } from './email.service';

@Global()
@Module({
  controllers: [AutomationsController],
  providers: [AutomationsService, AutomationRunner, AutomationScheduler, EmailService, AutomationIntentService],
  exports: [AutomationIntentService],
})
export class AutomationsModule {}
