import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../entities/user.entity';
import { PusherAuthDto } from '../posts/dto/pusher-auth.dto';
import { PusherService } from '../services/pusher.service';

@Controller('pusher')
@UseGuards(JwtAuthGuard)
export class PusherController {
  constructor(private readonly pusherService: PusherService) {}

  /**
   * Authenticates private channel subscriptions for the logged-in user.
   * Client channel must be: private-user-{userId}
   */
  @Post('auth')
  @HttpCode(HttpStatus.OK)
  auth(@CurrentUser() user: User, @Body() dto: PusherAuthDto) {
    return this.pusherService.authorizeChannel(
      user.id,
      dto.socket_id,
      dto.channel_name,
    );
  }
}
