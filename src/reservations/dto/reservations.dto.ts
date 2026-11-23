import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReservationStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateReservationDto {
  @ApiProperty({ format: 'uuid', example: '9c1d5e70-5a2b-4cd3-8f21-0b6f4a2e9d11' })
  @IsUUID()
  offerId: string;

  @ApiProperty({ example: 2, minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({
    example: '2026-11-24T11:00:00.000Z',
    description: 'Heure approximative de retrait (> maintenant et <= pickupDeadline)',
  })
  @Type(() => Date)
  @IsDate()
  estimatedPickupTime: Date;
}

export class ListReservationsDto {
  @ApiPropertyOptional({ enum: ReservationStatus })
  @IsOptional()
  @IsEnum(ReservationStatus)
  status?: ReservationStatus;

  @ApiPropertyOptional({
    enum: ['buyer', 'creator'],
    description: 'buyer = mes réservations, creator = réservations reçues sur mes offres',
  })
  @IsOptional()
  @IsIn(['buyer', 'creator'])
  role?: 'buyer' | 'creator';
}
