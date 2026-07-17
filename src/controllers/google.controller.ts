import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../entities/user.entity';
import { GoogleService } from '../services/google.service';

@Controller('google')
@UseGuards(JwtAuthGuard)
export class GoogleController {
  constructor(private readonly googleService: GoogleService) {}

  @Get('business-profiles')
  getBusinessProfiles(@CurrentUser() user: User) {
    return this.googleService.getBusinessProfilesForUser(user.id);
  }
}
