import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PostsService } from './posts.service';

@Injectable()
export class PostsSchedulerService {
  private readonly logger = new Logger(PostsSchedulerService.name);
  private running = false;

  constructor(private readonly postsService: PostsService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleDueScheduledPosts() {
    if (this.running) {
      this.logger.warn('Scheduled posts cron skipped (previous run still active)');
      return;
    }

    this.running = true;
    try {
      const result = await this.postsService.processDueScheduledPosts();
      if (result.processed > 0) {
        this.logger.log(
          `Scheduled cron: ${result.published} ok, ${result.failed} fail`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Scheduled posts cron failed: ${message}`);
    } finally {
      this.running = false;
    }
  }
}
