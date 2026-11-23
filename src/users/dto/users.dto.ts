import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export class UpdateProfileDto {
  @ApiProperty({ example: 'Jean Rakoto', required: false })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  fullName?: string;

  @ApiProperty({ example: 'jean@example.mg', required: false })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class BlockUserDto {
  @ApiProperty({ example: 'Signalement de fraude répété' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 500)
  blockReason: string;
}

export class ListUsersDto {
  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ example: 20, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @ApiPropertyOptional({ enum: Role })
  @IsOptional()
  @IsIn([Role.USER, Role.MERCHANT, Role.ADMIN])
  role?: Role;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  // Les query params arrivent en chaîne : "true" -> true, absent -> undefined
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  isManuallyBlocked?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  isPermanentlyBanned?: boolean;

  @ApiPropertyOptional({
    example: 'Rakoto',
    description: 'Recherche par nom ou téléphone',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;
}
