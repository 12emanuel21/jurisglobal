import { Module } from '@nestjs/common';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LeadNotifier } from './lead-notifier';
import { PublicConfigController } from './public-config.controller';

@Module({
  controllers: [LeadsController, PublicConfigController],
  providers: [LeadsService, LeadNotifier],
  exports: [LeadsService],
})
export class LeadsModule {}
