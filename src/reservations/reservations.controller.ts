import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role, type User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CreateReservationDto, ListReservationsDto } from './dto/reservations.dto.js';
import { ReservationsService } from './reservations.service.js';

@ApiTags('reservations')
@ApiBearerAuth()
@Controller('reservations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.USER, Role.MERCHANT, Role.ADMIN)
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  @Post()
  @Roles(Role.USER, Role.MERCHANT)
  @ApiOperation({
    summary: 'Réserver une offre (quantité, heure de retrait estimée)',
    description:
      'Synchronisation lazy avant création (no-shows +1h, expirations). Décrémente le stock en transaction et passe l’offre en SOLD_OUT à zéro.',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateReservationDto) {
    return this.reservations.create(user, dto);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Lister mes réservations (acheteur et/ou créateur)',
    description: 'Filtres optionnels status et role=buyer|creator.',
  })
  findMine(@CurrentUser() user: User, @Query() dto: ListReservationsDto) {
    return this.reservations.findMine(user, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d’une réservation (buyer, creator ou ADMIN)' })
  findOne(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.reservations.findOne(id, user);
  }

  @Patch(':id/confirm-pickup')
  @ApiOperation({
    summary: 'Double validation de la récupération (buyer puis creator)',
    description:
      'Passe COMPLETED et remet consecutiveCancellations à zéro dès que les deux confirmations sont réunies.',
  })
  confirmPickup(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.reservations.confirmPickup(id, user);
  }

  @Patch(':id/cancel-by-buyer')
  @ApiOperation({
    summary: 'Annulation par l’acheteur',
    description:
      'Remet le stock, incrémente consecutiveCancellations et applique 7j / 14j / ban définitif + quarantaine du numéro.',
  })
  cancelByBuyer(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.reservations.cancelByBuyer(id, user);
  }

  @Patch(':id/cancel-by-creator')
  @ApiOperation({
    summary: 'Annulation par le vendeur',
    description:
      'Remet le stock et incrémente creatorCancellationCount, sans pénaliser l’acheteur.',
  })
  cancelByCreator(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.reservations.cancelByCreator(id, user);
  }
}
