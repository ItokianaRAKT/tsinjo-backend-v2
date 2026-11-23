import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsEnum,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export enum ReviewTargetType {
  OFFER = 'OFFER',
  MERCHANT = 'MERCHANT',
}

export class CreateReviewDto {
  @ApiProperty({ format: 'uuid', example: '9c1d5e70-5a2b-4cd3-8f21-0b6f4a2e9d11' })
  @IsUUID()
  reservationId: string;

  @ApiProperty({ enum: ReviewTargetType, example: ReviewTargetType.MERCHANT })
  @IsEnum(ReviewTargetType)
  targetType: ReviewTargetType;

  @ApiProperty({ example: 5, minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ example: 'Pain encore chaud, excellent accueil.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class ListReviewsDto {
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

export class ReplyReviewDto {
  @ApiProperty({ example: 'Merci beaucoup pour votre retour !' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content: string;
}

export class VoteReviewDto {
  @ApiProperty({ example: true, description: 'true = like, false = dislike' })
  @IsBoolean()
  isHelpful: boolean;
}
