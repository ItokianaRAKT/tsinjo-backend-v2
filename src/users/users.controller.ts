import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import {
  BlockUserDto,
  ListUsersDto,
  UpdateProfileDto,
} from './dto/users.dto.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiOperation({
    summary:
      'Get the current user profile (merchant shop and sanction counters included)',
  })
  getMe(@CurrentUser() user: User) {
    return this.usersService.getMe(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update fullName and/or email of the current user' })
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateMe(user.id, dto);
  }

  @Delete('me')
  @ApiOperation({
    summary:
      'Soft-delete the current account and quarantine the phone for 60 days',
  })
  deleteMe(@CurrentUser() user: User) {
    return this.usersService.deleteMe(user.id);
  }

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin: paginated user list with optional filters' })
  list(@Query() dto: ListUsersDto) {
    return this.usersService.list(dto);
  }

  @Patch(':id/block')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary:
      'Admin: manually block a user, revoke tokens and suspend active offers',
  })
  block(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BlockUserDto) {
    return this.usersService.block(id, dto);
  }

  @Patch(':id/unblock')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Admin: manually unblock a user' })
  unblock(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.unblock(id);
  }
}
