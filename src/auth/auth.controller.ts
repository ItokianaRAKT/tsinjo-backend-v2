import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { LoginDto, RefreshDto, RegisterDto, VerifyPhoneWebhookDto } from './dto/auth.dto.js';
import { WebhookSecretGuard } from './guards/webhook-secret.guard.js';

// Le throttler global (100/min) est trop large pour les routes d'authentification.
const STRICT_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle(STRICT_THROTTLE)
  @ApiOperation({ summary: 'Register a new user and send a phone verification code' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify-phone-webhook')
  @HttpCode(200)
  @UseGuards(WebhookSecretGuard)
  @Throttle(STRICT_THROTTLE)
  @ApiOperation({ summary: 'Verify the phone code received by SMS (webhook)' })
  verifyPhoneWebhook(@Body() dto: VerifyPhoneWebhookDto) {
    return this.authService.verifyPhoneWebhook(dto);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(STRICT_THROTTLE)
  @ApiOperation({ summary: 'Login with phone/email and password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token' })
  refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoke the refresh token' })
  logout(@Body() dto: RefreshDto) {
    return this.authService.logout(dto);
  }
}
