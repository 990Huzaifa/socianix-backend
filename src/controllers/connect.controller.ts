import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConnectQueryDto } from '../connect/dto/connect-query.dto';
import type { OAuthCallbackQuery } from '../connect/dto/oauth-callback.dto';
import { User } from '../entities/user.entity';
import { ConnectService } from '../services/connect.service';

@Controller('oauth')
export class ConnectController {
  constructor(private readonly connectService: ConnectService) {}

  @Get('connect')
  @UseGuards(JwtAuthGuard)
  connect(@Query() query: ConnectQueryDto, @CurrentUser() user: User) {
    return this.connectService.getAuthorizationUrl(query.platform, user.id);
  }

  @Get('google/callback')
  googleCallback(@Query() query: OAuthCallbackQuery) {
    return this.connectService.handleCallback('google', query);
  }

  @Get('meta/callback')
  metaCallback(@Query() query: OAuthCallbackQuery) {
    return this.connectService.handleCallback('meta', query);
  }

  @Get('linkedin/callback')
  linkedinCallback(@Query() query: OAuthCallbackQuery) {
    return this.connectService.handleCallback('linkedin', query);
  }

  @Get('pinterest/callback')
  pinterestCallback(@Query() query: OAuthCallbackQuery) {
    return this.connectService.handleCallback('pinterest', query);
  }

  @Get('tiktok/callback')
  tiktokCallback(@Query() query: OAuthCallbackQuery) {
    return this.connectService.handleCallback('tiktok', query);
  }
}
