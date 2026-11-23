import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ReportReason, ReportStatus } from '@prisma/client';

export enum ReportTargetType {
  OFFER = 'OFFER',
  REVIEW = 'REVIEW',
  USER = 'USER',
}

export class CreateReportDto {
  @ApiProperty({ enum: ReportTargetType, example: ReportTargetType.OFFER })
  @IsEnum(ReportTargetType)
  targetType: ReportTargetType;

  @ApiProperty({
    format: 'uuid',
    example: '9c1d5e70-5a2b-4cd3-8f21-0b6f4a2e9d11',
    description: 'Identifiant de l’offre, de l’avis ou de l’utilisateur signalé',
  })
  @IsUUID()
  targetId: string;

  @ApiProperty({ enum: ReportReason, example: ReportReason.EXPIRED_PRODUCT })
  @IsEnum(ReportReason)
  reason: ReportReason;

  @ApiPropertyOptional({ example: 'Produit périmé dès la réception.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  details?: string;
}

export class ListReportsDto {
  @ApiPropertyOptional({ enum: ReportStatus })
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  @ApiPropertyOptional({ enum: ReportReason })
  @IsOptional()
  @IsEnum(ReportReason)
  reason?: ReportReason;

  @ApiPropertyOptional({ enum: ReportTargetType })
  @IsOptional()
  @IsEnum(ReportTargetType)
  targetType?: ReportTargetType;

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
}

export class ResolveReportDto {
  @ApiProperty({
    enum: [ReportStatus.ACCEPTED, ReportStatus.REJECTED],
    example: ReportStatus.ACCEPTED,
  })
  @IsIn([ReportStatus.ACCEPTED, ReportStatus.REJECTED])
  status: ReportStatus;

  @ApiPropertyOptional({ example: 'Signalement fondé, vendeur sanctionné.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  adminNote?: string;

  @ApiPropertyOptional({
    example: true,
    default: true,
    description: 'Masquer l’offre signalée quand le signalement est accepté',
  })
  @IsOptional()
  @IsBoolean()
  hideTarget?: boolean;
}
