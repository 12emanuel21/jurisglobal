import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeBridge } from './realtime-bridge';

@Global()
@Module({ imports: [AuthModule], providers: [RealtimeGateway, RealtimeBridge], exports: [RealtimeGateway] })
export class RealtimeModule {}
