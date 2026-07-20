import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../entities/user.entity';
import { SocialAccountsService } from '../services/social-accounts.service';

@Controller('platforms')
@UseGuards(JwtAuthGuard)
export class PlatformsController {
  constructor(private readonly socialAccountsService: SocialAccountsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.socialAccountsService.listPlatforms(user.id);
  }
}
