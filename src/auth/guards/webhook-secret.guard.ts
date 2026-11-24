import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

/**
 * Protège les webhooks fournisseurs (SMS) par un secret partagé.
 * Comparaison à temps constant pour éviter une fuite par timing.
 */
@Injectable()
export class WebhookSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
    }>();
    const header = request.headers['x-webhook-secret'];
    const provided = Buffer.from(typeof header === 'string' ? header : '');
    const expected = Buffer.from(this.config.getOrThrow<string>('SMS_WEBHOOK_SECRET'));

    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid webhook secret');
    }
    return true;
  }
}
