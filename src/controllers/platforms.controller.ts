import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../entities/user.entity';
import { ListPlatformsQueryDto } from '../platforms/dto/list-platforms-query.dto';
import { SocialAccountsService } from '../services/social-accounts.service';

@Controller('platforms')
@UseGuards(JwtAuthGuard)
export class PlatformsController {
  constructor(private readonly socialAccountsService: SocialAccountsService) {}

  /**
   * List social platforms stored in DB, with the current user's connection flag.
   * Optional: ?status=active|deactive|comingSoon
   */
  @Get()
  list(@CurrentUser() user: User, @Query() query: ListPlatformsQueryDto) {
    return this.socialAccountsService.listPlatforms(user.id, {
      status: query.status,
    });
  }
}
