import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import type { User } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { Roles } from '../auth/decorators/roles.decorator.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/guards/roles.guard.js';
import {
  CreateMerchantDto,
  UpdateMerchantDto,
  VerifyMerchantDto,
} from './dto/merchants.dto.js';
import { MerchantsService } from './merchants.service.js';

@ApiTags('merchants')
@ApiBearerAuth()
@Controller('merchants')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MerchantsController {
  constructor(private readonly merchantsService: MerchantsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create the current user shop (promotes a USER to MERCHANT, one shop max)',
  })
  create(@CurrentUser() user: User, @Body() dto: CreateMerchantDto) {
    return this.merchantsService.create(user, dto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the shop of the connected merchant' })
  getMe(@CurrentUser() user: User) {
    return this.merchantsService.getMe(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update the shop of the connected merchant' })
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateMerchantDto) {
    return this.merchantsService.updateMe(user.id, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Public merchant profile: rating, review count and verification status',
  })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.merchantsService.getById(id);
  }

  @Patch(':id/verify')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin: certify or decertify a shop' })
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyMerchantDto,
  ) {
    return this.merchantsService.verify(id, dto);
  }
}
