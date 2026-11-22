import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { clientIpOf } from './client-ip';

/** ThrottlerGuard que cuenta por la IP real del visitante (Cloudflare → nginx), no por la de nginx */
@Injectable()
export class RealIpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(clientIpOf(req as Parameters<typeof clientIpOf>[0]));
  }
}
