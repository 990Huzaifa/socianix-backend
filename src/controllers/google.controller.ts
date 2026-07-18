import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../entities/user.entity';
import { GoogleService } from '../services/google.service';

@Controller('google')
export class GoogleController {
  constructor(
    private readonly googleService: GoogleService,
    private readonly configService: ConfigService,
  ) {}

  @Get('business-profiles')
  @UseGuards(JwtAuthGuard)
  getBusinessProfiles(@CurrentUser() user: User) {
    return this.googleService.getBusinessProfilesForUser(user.id);
  }

  /**
   * Cron / ops endpoint.
   * - With ?userId=... refreshes that user's Google token
   * - Without userId refreshes all active Google accounts
   * Optional header: x-cron-secret (required if CRON_SECRET is set in env)
   */
  @Get('refresh-token')
  refreshToken(
    @Query('userId') userId: string | undefined,
    @Headers('x-cron-secret') cronSecret?: string,
  ) {
    this.assertCronAccess(cronSecret);

    if (userId) {
      return this.googleService.refreshAccessTokenByUserId(userId);
    }

    return this.googleService.refreshAllAccessTokens();
  }

  private assertCronAccess(cronSecret?: string) {
    const expected = this.configService.get<string>('CRON_SECRET');
    if (!expected) {
      return;
    }

    if (!cronSecret || cronSecret !== expected) {
      throw new ForbiddenException('Invalid cron secret');
    }
  }
}
