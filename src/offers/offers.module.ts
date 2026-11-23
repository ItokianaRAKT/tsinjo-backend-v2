import { Module } from '@nestjs/common';
import { OffersController } from './offers.controller.js';
import { OffersService } from './offers.service.js';
import { OffersSyncService } from './offers-sync.service.js';

@Module({
  controllers: [OffersController],
  providers: [OffersService, OffersSyncService],
})
export class OffersModule {}
