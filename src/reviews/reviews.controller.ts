import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
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
  CreateReviewDto,
  ListReviewsDto,
  ReplyReviewDto,
  VoteReviewDto,
} from './dto/reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

@ApiTags('reviews')
@ApiBearerAuth()
@Controller('reviews')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.USER, Role.MERCHANT, Role.ADMIN)
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  @ApiOperation({
    summary: 'Noter une réservation complétée (offre ou marchand)',
    description:
      'Un seul avis par réservation. Recalcule la note moyenne et le nombre d’avis du marchand quand l’offre lui appartient.',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateReviewDto) {
    return this.reviews.create(user, dto);
  }

  @Get('offer/:offerId')
  @ApiOperation({
    summary: 'Avis d’une offre (paginés, pertinence décroissante)',
    description: 'Inclut l’auteur, la réponse du marchand, les votes et mon vote.',
  })
  findByOffer(
    @Param('offerId', ParseUUIDPipe) offerId: string,
    @CurrentUser() user: User,
    @Query() dto: ListReviewsDto,
  ) {
    return this.reviews.findByOffer(offerId, user, dto);
  }

  @Get('merchant/:merchantId')
  @ApiOperation({
    summary: 'Avis d’un marchand (paginés, pertinence décroissante)',
    description: 'Inclut l’auteur, la réponse du marchand, les votes et mon vote.',
  })
  findByMerchant(
    @Param('merchantId', ParseUUIDPipe) merchantId: string,
    @CurrentUser() user: User,
    @Query() dto: ListReviewsDto,
  ) {
    return this.reviews.findByMerchant(merchantId, user, dto);
  }

  @Post(':id/reply')
  @ApiOperation({
    summary: 'Réponse unique du marchand concerné à un avis',
    description: 'Réservé au propriétaire du marchand visé, directement ou via l’offre.',
  })
  reply(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: ReplyReviewDto,
  ) {
    return this.reviews.reply(id, user, dto);
  }

  @Post(':id/vote')
  @ApiOperation({
    summary: 'Voter sur la pertinence d’un avis (like/dislike)',
    description:
      'Un vote par utilisateur et par avis, modifiable. L’auteur de l’avis ne peut pas voter.',
  })
  vote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body() dto: VoteReviewDto,
  ) {
    return this.reviews.vote(id, user, dto);
  }
}
