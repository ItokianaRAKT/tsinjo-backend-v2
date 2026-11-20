import { Role } from '@prisma/client';
import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, Length, Matches, MinLength } from 'class-validator';

// Format E.164 simplifié : + suivi de 8 à 15 chiffres
export const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  fullName: string;

  @IsString()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid phone number' })
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(8)
  password: string;

  // L'auto-attribution de ADMIN est interdite
  @IsOptional()
  @IsIn([Role.USER, Role.MERCHANT])
  role?: Role;
}

export class VerifyPhoneWebhookDto {
  @IsString()
  @Matches(PHONE_REGEX, { message: 'phone must be a valid phone number' })
  phone: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^[A-Za-z0-9]+$/, { message: 'code must be 6 alphanumeric characters' })
  code: string;
}

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  identifier: string; // phone ou email

  @IsString()
  @IsNotEmpty()
  password: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
