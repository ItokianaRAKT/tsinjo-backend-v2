import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMerchantDto {
  @ApiProperty({ example: 'Boulangerie Fiangonana' })
  @IsString()
  @IsNotEmpty()
  @Length(2, 100)
  businessName: string;

  @ApiProperty({ example: "12 rue de l'Indépendance, Analakely" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address: string;

  @ApiProperty({ example: 'Analakely' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  quartier: string;

  @ApiProperty({ example: -18.9092, description: 'Latitude (GPS)' })
  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @ApiProperty({ example: 47.5237, description: 'Longitude (GPS)' })
  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @ApiPropertyOptional({
    example: 'Pains et viennoiseries artisanales chaque matin.',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class UpdateMerchantDto extends PartialType(CreateMerchantDto) {}

export class VerifyMerchantDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  isVerified: boolean;
}
