import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import { Post, PostStatus } from '../entities/post.entity';
import { PostMedia, PostMediaType } from '../entities/post-media.entity';
import { CreatePostDto } from '../posts/dto/create-post.dto';
import { POST_JOBS, POSTS_QUEUE } from '../posts/post.constants';
import { S3Service } from './s3.service';

export type ProcessCreatePostJob = {
  postId: string;
  userId: string;
};

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
    @InjectQueue(POSTS_QUEUE)
    private readonly postsQueue: Queue<ProcessCreatePostJob>,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Uploads media to S3, saves post + S3 URLs in DB, then enqueues processing.
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

    await this.postsQueue.add(
      POST_JOBS.PROCESS_CREATE,
      { postId: post.id, userId },
      {
        removeOnComplete: 100,
        removeOnFail: 200,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      },
    );

    this.logger.log(`Queued post create job postId=${post.id} user=${userId}`);

    return {
      message: 'Post is processing',
      status: 'processing',
      postId: post.id,
      channel: `private-user-${userId}`,
      event: 'post.processed',
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

  async getOwnedPost(postId: string, userId: string): Promise<Post> {
    const post = await this.postsRepository.findOne({
      where: { id: postId, userId },
      relations: { media: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return post;
  }

  async finalizeCreateProcessing(postId: string, userId: string): Promise<Post> {
    const post = await this.getOwnedPost(postId, userId);

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

  async markCreateFailed(postId: string, userId: string, errorMessage: string) {
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
