import {
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Pusher from 'pusher';
import { userPrivateChannel } from '../posts/post.constants';

@Injectable()
export class PusherService implements OnModuleInit {
  private readonly logger = new Logger(PusherService.name);
  private client: Pusher | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const appId = this.configService.get<string>('PUSHER_APP_ID');
    const key = this.configService.get<string>('PUSHER_KEY');
    const secret = this.configService.get<string>('PUSHER_SECRET');
    const cluster = this.configService.get<string>('PUSHER_CLUSTER') ?? 'mt1';

    if (!appId || !key || !secret) {
      this.logger.warn(
        'Pusher is not fully configured (PUSHER_APP_ID/KEY/SECRET). Realtime events will be skipped.',
      );
      return;
    }

    this.client = new Pusher({
      appId,
      key,
      secret,
      cluster,
      useTLS: true,
    });

    this.logger.log(`Pusher initialized (cluster=${cluster})`);
  }

  isEnabled(): boolean {
    return this.client != null;
  }

  authorizeChannel(userId: string, socketId: string, channelName: string) {
    if (!this.client) {
      throw new ForbiddenException('Pusher is not configured');
    }

    const expected = userPrivateChannel(userId);
    if (channelName !== expected) {
      throw new ForbiddenException('Not allowed to subscribe to this channel');
    }

    return this.client.authorizeChannel(socketId, channelName);
  }

  async triggerUserEvent(
    userId: string,
    event: string,
    payload: Record<string, unknown>,
  ) {
    if (!this.client) {
      this.logger.warn(
        `Skipping Pusher event "${event}" for user=${userId} (not configured)`,
      );
      return;
    }

    const channel = userPrivateChannel(userId);
    await this.client.trigger(channel, event, payload);
    this.logger.log(`Pusher event "${event}" sent on ${channel}`);
  }
}
