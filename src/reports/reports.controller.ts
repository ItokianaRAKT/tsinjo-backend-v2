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
import {
  CreateReportDto,
  ListReportsDto,
  ResolveReportDto,
} from './dto/reports.dto.js';
import { ReportsService } from './reports.service.js';

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.USER, Role.MERCHANT, Role.ADMIN)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiOperation({
    summary: 'Signaler une offre, un avis ou un utilisateur',
    description:
      'Un seul signalement par cible et par utilisateur. Interdit de se signaler soi-même ou ses propres contenus.',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateReportDto) {
    return this.reports.create(user, dto);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Liste paginée des signalements (admin)',
    description:
      'Filtres par statut, motif et type de cible. Inclut la cible signalée et le rapporteur.',
  })
  findAll(@Query() dto: ListReportsDto) {
    return this.reports.findAll(dto);
  }

  @Patch(':id/resolve')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Traiter un signalement (admin)',
    description:
      'ACCEPTED applique les sanctions automatiques (7j au 3e, 14j au 5e, bannissement et quarantaine 60j au 6e signalement accepté).',
  })
  resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reports.resolve(id, dto);
  }
}
