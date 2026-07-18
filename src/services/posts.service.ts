import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Post, PostStatus } from '../entities/post.entity';
import { PostMedia, PostMediaType } from '../entities/post-media.entity';
import { CreatePostDto } from '../posts/dto/create-post.dto';
import {
  PUSHER_EVENTS,
  userPrivateChannel,
} from '../posts/post.constants';
import { PusherService } from './pusher.service';
import { S3Service } from './s3.service';

type UploadedMediaFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    @InjectRepository(Post)
    private readonly postsRepository: Repository<Post>,
    @InjectRepository(PostMedia)
    private readonly postMediaRepository: Repository<PostMedia>,
    private readonly s3Service: S3Service,
    private readonly pusherService: PusherService,
  ) {}

  /**
   * Uploads media to S3, saves post + S3 URLs in DB, returns immediately,
   * then finishes work in a Node background task and notifies via Pusher.
   * Platform publishing is intentionally not wired yet.
   */
  async create(
    userId: string,
    dto: CreatePostDto,
    files: UploadedMediaFile[] = [],
  ) {
    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : null;

    const post = await this.postsRepository.save(
      this.postsRepository.create({
        userId,
        title: dto.title?.trim() || null,
        caption: dto.caption?.trim() || null,
        scheduledAt,
        status: PostStatus.PUBLISHING,
        publishedAt: null,
      }),
    );

    if (files.length) {
      if (!this.s3Service.isEnabled()) {
        await this.postsRepository.delete(post.id);
        throw new BadRequestException('S3 is not configured for media uploads');
      }

      const mediaRows: PostMedia[] = [];

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const mediaType = this.resolveMediaType(file.mimetype);
        const folder = mediaType === PostMediaType.VIDEO ? 'video' : 'image';

        const uploaded = await this.s3Service.uploadFile({
          buffer: file.buffer,
          originalName: file.originalname,
          mimeType: file.mimetype,
          folder,
        });

        mediaRows.push(
          this.postMediaRepository.create({
            postId: post.id,
            type: mediaType,
            url: uploaded.url,
            order: index,
          }),
        );
      }

      await this.postMediaRepository.save(mediaRows);
    }

    // Fire-and-forget Node background work (no Redis / BullMQ).
    setImmediate(() => {
      void this.processCreateInBackground(post.id, userId);
    });

    this.logger.log(
      `Post create accepted; background processing started postId=${post.id} user=${userId}`,
    );

    return {
      message: 'Post is processing',
      status: 'processing',
      postId: post.id,
      channel: userPrivateChannel(userId),
      event: PUSHER_EVENTS.POST_PROCESSED,
    };
  }

  async findAllForUser(userId: string) {
    const posts = await this.postsRepository.find({
      where: { userId },
      relations: { media: true, platforms: true },
      order: { createdAt: 'DESC' },
    });

    return { posts, total: posts.length };
  }

  async findOneForUser(userId: string, postId: string) {
    const post = await this.postsRepository.findOne({
      where: { id: postId, userId },
      relations: { media: true, platforms: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  private async processCreateInBackground(postId: string, userId: string) {
    this.logger.log(`Background processing postId=${postId}`);

    try {
      const post = await this.finalizeCreateProcessing(postId, userId);

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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.markCreateFailed(postId, userId, message);

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
    }
  }

  private async finalizeCreateProcessing(
    postId: string,
    userId: string,
  ): Promise<Post> {
    const post = await this.postsRepository.findOne({
      where: { id: postId, userId },
      relations: { media: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const now = Date.now();
    if (post.scheduledAt && post.scheduledAt.getTime() > now) {
      post.status = PostStatus.SCHEDULED;
      post.publishedAt = null;
    } else {
      post.status = PostStatus.DRAFT;
      post.publishedAt = null;
    }

    return this.postsRepository.save(post);
  }

  private async markCreateFailed(
    postId: string,
    userId: string,
    errorMessage: string,
  ) {
    const post = await this.postsRepository.findOne({
      where: { id: postId, userId },
    });
    if (!post) {
      return null;
    }

    post.status = PostStatus.FAILED;
    this.logger.error(
      `Post create processing failed postId=${postId}: ${errorMessage}`,
    );
    return this.postsRepository.save(post);
  }

  private resolveMediaType(mimeType: string): PostMediaType {
    if (mimeType.startsWith('video/')) {
      return PostMediaType.VIDEO;
    }
    if (mimeType.startsWith('image/')) {
      return PostMediaType.IMAGE;
    }
    throw new BadRequestException(
      `Unsupported media type "${mimeType}". Only image/* and video/* are allowed.`,
    );
  }
}
