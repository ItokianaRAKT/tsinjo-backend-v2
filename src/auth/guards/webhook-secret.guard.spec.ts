import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { WebhookSecretGuard } from './webhook-secret.guard.js';

const contextWith = (headers: Record<string, string | string[] | undefined>) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as never;

const configWith = (secret: string) =>
  ({ getOrThrow: () => secret }) as unknown as ConfigService;

describe('WebhookSecretGuard', () => {
  const guard = new WebhookSecretGuard(configWith('s3cret-webhook'));

  it('accepts a matching X-Webhook-Secret header', () => {
    expect(guard.canActivate(contextWith({ 'x-webhook-secret': 's3cret-webhook' }))).toBe(true);
  });

  it('rejects a wrong secret', () => {
    expect(() => guard.canActivate(contextWith({ 'x-webhook-secret': 'nope' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a missing header', () => {
    expect(() => guard.canActivate(contextWith({}))).toThrow(UnauthorizedException);
  });
});
