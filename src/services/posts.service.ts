import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { Post, PostStatus } from '../entities/post.entity';
import { PostMedia, PostMediaType } from '../entities/post-media.entity';
import {
  PlatformPostStatus,
  PostPlatform,
} from '../entities/post-platform.entity';
import { CreatePostDto, GoogleCtaActionType } from '../posts/dto/create-post.dto';
import {
  PUSHER_EVENTS,
  userPrivateChannel,
} from '../posts/post.constants';
import { GoogleService } from './google.service';
import { PusherService } from './pusher.service';
import { S3Service } from './s3.service';
import { SocialAccountsService } from './social-accounts.service';

type UploadedMediaFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
};

type GooglePublishOptions = {
  postPlatformId: string;
  accountId: string;
  locationId: string;
  actionType: GoogleCtaActionType;
  ctaUrl?: string | null;
};

type GooglePlatformMetadata = {
  provider: 'google';
  accountId: string;
  locationId: string;
  actionType: GoogleCtaActionType;
  ctaUrl?: string | null;
};

@Injectable()
export class PostsService {
  private readonly logger = new Logger(PostsService.name);

  constructor(
    @InjectRepository(Post)
    private readonly postsRepository: Repository<Post>,
    @InjectRepository(PostMedia)
    private readonly postMediaRepository: Repository<PostMedia>,
    @InjectRepository(PostPlatform)
    private readonly postPlatformRepository: Repository<PostPlatform>,
    private readonly s3Service: S3Service,
    private readonly pusherService: PusherService,
    private readonly googleService: GoogleService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  /**
   * Uploads media to S3, saves post + S3 URLs in DB, returns immediately,
   * then finishes work in a Node background task and notifies via Pusher.
   * When googlePost=true, also publishes to Google Business Profile
   * (or defers until scheduledAt via cron).
   */
  async create(
    userId: string,
    dto: CreatePostDto,
    files: UploadedMediaFile[] = [],
  ) {
    const googlePost = dto.googlePost === true;
    let googleSocialAccountId: string | null = null;

    if (googlePost) {
      const googleAccount =
        await this.socialAccountsService.findActiveByUserAndPlatform(
          userId,
          'google',
        );
      googleSocialAccountId = googleAccount.id;

      if (!dto.caption?.trim() && !dto.title?.trim()) {
        throw new BadRequestException(
          'caption or title is required when googlePost is true',
        );
      }
    }

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

    let googleOptions: GooglePublishOptions | null = null;

    if (googlePost && googleSocialAccountId) {
      const actionType = dto.googleCtaActionType!;
      const ctaUrl = actionType === 'CALL' ? null : (dto.googleCtaUrl ?? null);
      const metadata: GooglePlatformMetadata = {
        provider: 'google',
        accountId: dto.googleAccountId!,
        locationId: dto.googleLocationId!,
        actionType,
        ctaUrl,
      };

      const postPlatform = await this.postPlatformRepository.save(
        this.postPlatformRepository.create({
          postId: post.id,
          socialAccountId: googleSocialAccountId,
          socialPageId: null,
          platformStatus: PlatformPostStatus.PENDING,
          platformPostId: null,
          publishedAt: null,
          errorMessage: null,
          metadata,
        }),
      );

      googleOptions = {
        postPlatformId: postPlatform.id,
        accountId: metadata.accountId,
        locationId: metadata.locationId,
        actionType: metadata.actionType,
        ctaUrl: metadata.ctaUrl,
      };
    }

    setImmediate(() => {
      void this.processCreateInBackground(post.id, userId, googleOptions);
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
      googlePost,
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

  /**
   * Cron entry: publish due Scheduled posts (every minute).
   */
  async processDueScheduledPosts() {
    const now = new Date();
    const duePosts = await this.postsRepository.find({
      where: {
        status: PostStatus.SCHEDULED,
        scheduledAt: LessThanOrEqual(now),
      },
      relations: { media: true, platforms: true },
      order: { scheduledAt: 'ASC' },
      take: 50,
    });

    let processed = 0;
    let published = 0;
    let failed = 0;

    for (const due of duePosts) {
      const claimed = await this.postsRepository.update(
        { id: due.id, status: PostStatus.SCHEDULED },
        { status: PostStatus.PUBLISHING },
      );
      if (!claimed.affected) {
        continue;
      }

      processed += 1;

      try {
        const post = await this.postsRepository.findOne({
          where: { id: due.id },
          relations: { media: true, platforms: true },
        });
        if (!post) {
          continue;
        }

        const pendingPlatforms = (post.platforms ?? []).filter(
          (p) => p.platformStatus === PlatformPostStatus.PENDING,
        );

        const googleResults: Record<string, unknown>[] = [];

        for (const platform of pendingPlatforms) {
          const meta = platform.metadata as GooglePlatformMetadata | null;
          if (!meta || meta.provider !== 'google') {
            continue;
          }

          const result = await this.publishGoogleBusinessPost(post.userId, post, {
            postPlatformId: platform.id,
            accountId: meta.accountId,
            locationId: meta.locationId,
            actionType: meta.actionType,
            ctaUrl: meta.ctaUrl ?? null,
          });
          googleResults.push(result);
        }

        const platforms = await this.postPlatformRepository.find({
          where: { postId: post.id },
        });

        const anyFailed = platforms.some(
          (p) => p.platformStatus === PlatformPostStatus.FAILED,
        );
        const anyPublished = platforms.some(
          (p) => p.platformStatus === PlatformPostStatus.PUBLISHED,
        );

        if (anyPublished) {
          post.status = PostStatus.PUBLISHED;
          post.publishedAt = new Date();
          published += 1;
        } else if (anyFailed) {
          post.status = PostStatus.FAILED;
          failed += 1;
        } else {
          // No platforms or still pending — mark published locally at schedule time.
          post.status = PostStatus.PUBLISHED;
          post.publishedAt = new Date();
          published += 1;
        }

        await this.postsRepository.save(post);

        await this.pusherService.triggerUserEvent(
          post.userId,
          PUSHER_EVENTS.POST_PROCESSED,
          {
            postId: post.id,
            status: post.status,
            message: 'Scheduled post processing completed',
            channel: userPrivateChannel(post.userId),
            scheduled: true,
            google: googleResults[0] ?? null,
            googleResults,
            platforms,
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
        failed += 1;
        await this.markCreateFailed(due.id, due.userId, message);
        await this.pusherService.triggerUserEvent(
          due.userId,
          PUSHER_EVENTS.POST_PROCESSED,
          {
            postId: due.id,
            status: 'Failed',
            message: 'Scheduled post processing failed',
            error: message,
            scheduled: true,
            channel: userPrivateChannel(due.userId),
          },
        );
      }
    }

    return { processed, published, failed, totalDue: duePosts.length };
  }

  private async processCreateInBackground(
    postId: string,
    userId: string,
    googleOptions: GooglePublishOptions | null,
  ) {
    this.logger.log(`Background processing postId=${postId}`);

    try {
      const post = await this.finalizeCreateProcessing(postId, userId);
      let googleResult: Record<string, unknown> | null = null;

      if (googleOptions) {
        googleResult = await this.publishGoogleBusinessPost(
          userId,
          post,
          googleOptions,
        );
      }

      const platforms = await this.postPlatformRepository.find({
        where: { postId },
      });

      await this.pusherService.triggerUserEvent(
        userId,
        PUSHER_EVENTS.POST_PROCESSED,
        {
          postId: post.id,
          status: post.status,
          message: 'Post processing completed',
          channel: userPrivateChannel(userId),
          google: googleResult,
          platforms,
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

  private async publishGoogleBusinessPost(
    userId: string,
    post: Post,
    options: GooglePublishOptions,
  ): Promise<Record<string, unknown>> {
    const postPlatform = await this.postPlatformRepository.findOne({
      where: { id: options.postPlatformId },
    });

    if (!postPlatform) {
      return {
        status: 'Failed',
        error: 'Post platform row not found',
      };
    }

    // Deferred until cron: only SCHEDULED posts skip publish.
    if (post.status === PostStatus.SCHEDULED) {
      this.logger.log(
        `Skipping Google publish for scheduled postId=${post.id}; leaving PostPlatform Pending`,
      );
      return {
        status: PlatformPostStatus.PENDING,
        skipped: true,
        reason: 'scheduled_for_later',
      };
    }

    postPlatform.platformStatus = PlatformPostStatus.PUBLISHING;
    await this.postPlatformRepository.save(postPlatform);

    const summary = (post.caption?.trim() || post.title?.trim() || '').trim();
    if (!summary) {
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage = 'Missing summary for Google Business post';
      await this.postPlatformRepository.save(postPlatform);
      return {
        status: PlatformPostStatus.FAILED,
        error: postPlatform.errorMessage,
      };
    }

    try {
      const callToAction =
        options.actionType === 'CALL'
          ? { actionType: 'CALL' as const }
          : {
              actionType: options.actionType,
              url: options.ctaUrl ?? undefined,
            };

      const media = (post.media ?? []).map((item) => ({
        mediaFormat:
          item.type === PostMediaType.VIDEO
            ? ('VIDEO' as const)
            : ('PHOTO' as const),
        sourceUrl: item.url,
      }));

      const created = await this.googleService.createBusinessPostForUser(
        userId,
        {
          accountId: options.accountId,
          locationId: options.locationId,
        },
        {
          summary,
          topicType: 'STANDARD',
          callToAction,
          media: media.length ? media : undefined,
        },
      );

      postPlatform.platformStatus = PlatformPostStatus.PUBLISHED;
      postPlatform.platformPostId = created.postId ?? created.postName;
      postPlatform.publishedAt = new Date();
      postPlatform.errorMessage = null;
      await this.postPlatformRepository.save(postPlatform);

      return {
        status: PlatformPostStatus.PUBLISHED,
        platformPostId: postPlatform.platformPostId,
        searchUrl: created.searchUrl,
        parent: created.parent,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Google Business publish failed postId=${post.id}: ${message}`,
      );

      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage = message;
      await this.postPlatformRepository.save(postPlatform);

      return {
        status: PlatformPostStatus.FAILED,
        error: message,
      };
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
