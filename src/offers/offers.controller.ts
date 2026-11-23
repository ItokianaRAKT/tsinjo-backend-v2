import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import { CreateOfferDto, ListOffersDto, UpdateOfferDto } from './dto/offers.dto.js';
import { OffersService } from './offers.service.js';

@ApiTags('offers')
@ApiBearerAuth()
@Controller('offers')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Get()
  @ApiOperation({
    summary:
      'Catalogue : offres actives avec filtres, recherche, tri (default/distance/dlc) et distance Haversine',
    description:
      'Synchronisation lazy du catalogue (no-shows +1h et expirations) exécutée avant chaque lecture.',
  })
  findAll(@Query() dto: ListOffersDto) {
    return this.offersService.findAll(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d’une offre avec son % de solde calculé' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.offersService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.USER, Role.MERCHANT)
  @ApiOperation({
    summary: 'Créer une offre (USER ou MERCHANT, 1 photo minimum obligatoire)',
    description:
      "pickupDeadline doit être postérieure à maintenant et antérieure à la DLC. Les marchands avec boutique peuvent définir originalPrice (>= price) et héritent de l'adresse de leur boutique par défaut.",
  })
  create(@CurrentUser() user: User, @Body() dto: CreateOfferDto) {
    return this.offersService.create(user, dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({ summary: 'Modifier une offre (créateur ou ADMIN uniquement)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateOfferDto,
  ) {
    return this.offersService.update(id, user, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @ApiOperation({
    summary: 'Annuler / retirer une offre (créateur ou ADMIN uniquement)',
    description:
      "Une offre ayant des réservations n'est jamais supprimée physiquement : elle passe en EXPIRED.",
  })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: User) {
    return this.offersService.remove(id, user);
  }
}
