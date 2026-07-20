import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ConnectQueryDto } from '../connect/dto/connect-query.dto';
import type { OAuthCallbackQuery } from '../connect/dto/oauth-callback.dto';
import { ConnectPlatform } from '../connect/connect-platform.type';
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

  @Post('disconnect')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  disconnect(@Query() query: ConnectQueryDto, @CurrentUser() user: User) {
    return this.connectService.disconnect(query.platform, user.id);
  }

  @Get('google/callback')
  googleCallback(@Query() query: OAuthCallbackQuery, @Res() res: Response) {
    return this.redirectCallback('google', query, res);
  }

  @Get('meta/callback')
  metaCallback(@Query() query: OAuthCallbackQuery, @Res() res: Response) {
    return this.redirectCallback('meta', query, res);
  }

  @Get('linkedin/callback')
  linkedinCallback(@Query() query: OAuthCallbackQuery, @Res() res: Response) {
    return this.redirectCallback('linkedin', query, res);
  }

  @Get('pinterest/callback')
  pinterestCallback(@Query() query: OAuthCallbackQuery, @Res() res: Response) {
    return this.redirectCallback('pinterest', query, res);
  }

  @Get('tiktok/callback')
  tiktokCallback(@Query() query: OAuthCallbackQuery, @Res() res: Response) {
    return this.redirectCallback('tiktok', query, res);
  }

  @Get('thread/callback')
  threadCallback(@Query() query: OAuthCallbackQuery, @Res() res: Response) {
    return this.redirectCallback('thread', query, res);
  }

  @Get('x/callback')
  xCallback(@Query() query: OAuthCallbackQuery, @Res() res: Response) {
    return this.redirectCallback('x', query, res);
  }

  private async redirectCallback(
    platform: ConnectPlatform,
    query: OAuthCallbackQuery,
    res: Response,
  ) {
    const redirectUrl = await this.connectService.handleCallback(
      platform,
      query,
    );
    return res.redirect(302, redirectUrl);
  }
}
