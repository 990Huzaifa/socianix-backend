import { Controller, Get, Query } from '@nestjs/common';
import type { OAuthCallbackQuery } from '../connect/dto/oauth-callback.dto';
import { ConnectService } from '../services/connect.service';

@Controller('oauth')
export class ConnectController {
  constructor(private readonly connectService: ConnectService) {}

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
