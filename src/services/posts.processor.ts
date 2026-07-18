import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  POSTS_QUEUE,
  PUSHER_EVENTS,
  userPrivateChannel,
} from '../posts/post.constants';
import {
  PostsService,
  ProcessCreatePostJob,
} from './posts.service';
import { PusherService } from './pusher.service';

@Processor(POSTS_QUEUE)
export class PostsProcessor extends WorkerHost {
  private readonly logger = new Logger(PostsProcessor.name);

  constructor(
    private readonly postsService: PostsService,
    private readonly pusherService: PusherService,
  ) {
    super();
  }

  async process(job: Job<ProcessCreatePostJob>) {
    const { postId, userId } = job.data;
    this.logger.log(`Processing post job=${job.name} postId=${postId}`);

    try {
      const post = await this.postsService.finalizeCreateProcessing(
        postId,
        userId,
      );

      await this.pusherService.triggerUserEvent(
        userId,
        PUSHER_EVENTS.POST_PROCESSED,
        {
          postId: post.id,
          status: post.status,
          message: 'Post processing completed',
          channel: userPrivateChannel(userId),
          post: {
            id: post.id,
            title: post.title,
            caption: post.caption,
            status: post.status,
            scheduledAt: post.scheduledAt,
            publishedAt: post.publishedAt,
            media: post.media ?? [],
            createdAt: post.createdAt,
            updatedAt: post.updatedAt,
          },
        },
      );

      return { postId: post.id, status: post.status };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.postsService.markCreateFailed(postId, userId, message);

      await this.pusherService.triggerUserEvent(
        userId,
        PUSHER_EVENTS.POST_PROCESSED,
        {
          postId,
          status: 'Failed',
          message: 'Post processing failed',
          error: message,
          channel: userPrivateChannel(userId),
        },
      );

      throw error;
    }
  }
}
