import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartialType } from '@nestjs/swagger';
import { FoodCategory } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class OfferImageDto {
  @ApiProperty({ example: '/uploads/offers/8f3e...-a1b2.jpg' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  url: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isMain: boolean;
}

export class CreateOfferDto {
  @ApiProperty({ example: 'Panier surprise du jour' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 120)
  title: string;

  @ApiPropertyOptional({
    example: 'Assortiment de pains et viennoiseries invendus du jour.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: FoodCategory, example: FoodCategory.PANIER_SURPRISE })
  @IsEnum(FoodCategory)
  category: FoodCategory;

  @ApiProperty({
    type: [OfferImageDto],
    description: '1 à 5 photos réelles (photo principale = isMain true)',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OfferImageDto)
  images: OfferImageDto[];

  @ApiProperty({ example: 3000, description: 'Prix en ariary (0 = don)' })
  @IsInt()
  @Min(0)
  price: number;

  @ApiPropertyOptional({
    example: 5000,
    description: "Prix d'origine (marchand uniquement, doit être >= price)",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  originalPrice?: number;

  @ApiPropertyOptional({ example: 5, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantityAvailable?: number;

  @ApiPropertyOptional({
    example: "12 rue de l'Indépendance, Analakely",
    description: 'Requis si le créateur ne possède pas de boutique',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ example: 'Analakely' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  quartier?: string;

  @ApiPropertyOptional({ example: -18.9092, description: 'Latitude (GPS)' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 47.5237, description: 'Longitude (GPS)' })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiProperty({
    example: '2026-11-25T18:00:00.000Z',
    description: 'DLC (date limite de consommation)',
  })
  @Type(() => Date)
  @IsDate()
  expirationDate: Date;

  @ApiProperty({
    example: '2026-11-24T12:00:00.000Z',
    description: 'Deadline de retrait, strictement après maintenant et avant la DLC',
  })
  @Type(() => Date)
  @IsDate()
  pickupDeadline: Date;
}

export class UpdateOfferDto extends PartialType(CreateOfferDto) {}

export class ListOffersDto {
  @ApiPropertyOptional({ enum: FoodCategory })
  @IsOptional()
  @IsEnum(FoodCategory)
  category?: FoodCategory;

  @ApiPropertyOptional({ example: 'Analakely' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  quartier?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  merchantId?: string;

  @ApiPropertyOptional({ example: false, description: 'Uniquement price = 0' })
  @IsOptional()
  // Les query params arrivent en chaîne : "true" -> true, absent -> undefined
  @Transform(({ value }) =>
    value === undefined ? undefined : value === 'true' || value === true,
  )
  @IsBoolean()
  onlyFree?: boolean;

  @ApiPropertyOptional({ example: 'pain', description: 'Titre ou description' })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ example: -18.9092 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ example: 47.5237 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({
    example: 5,
    description: 'Rayon maximum en km (requiert lat et lng)',
  })
  @IsOptional()
  @Type(() => Number)
  @Min(0)
  maxDistanceKm?: number;

  @ApiPropertyOptional({
    enum: ['default', 'distance', 'dlc'],
    default: 'default',
  })
  @IsOptional()
  @IsIn(['default', 'distance', 'dlc'])
  sortBy?: 'default' | 'distance' | 'dlc';
}
