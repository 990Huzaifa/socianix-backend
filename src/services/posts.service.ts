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
import {
  CreatePostDto,
  CreatePostStatus,
  GoogleCtaActionType,
} from '../posts/dto/create-post.dto';
import {
  PUSHER_EVENTS,
  userPrivateChannel,
} from '../posts/post.constants';
import { GoogleService } from './google.service';
import { LinkedInService } from './linkedin.service';
import { MetaService } from './meta.service';
import { PinterestService } from './pinterest.service';
import { PusherService } from './pusher.service';
import { S3Service } from './s3.service';
import { SocialAccountsService } from './social-accounts.service';
import { ThreadsService } from './threads.service';

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

type PinterestPublishOptions = {
  postPlatformId: string;
  boardId: string;
  link?: string | null;
};

type PinterestPlatformMetadata = {
  provider: 'pinterest';
  boardId: string;
  link?: string | null;
};

type FacebookPublishOptions = {
  postPlatformId: string;
  pageId: string;
  link?: string | null;
};

type FacebookPlatformMetadata = {
  provider: 'facebook';
  pageId: string;
  link?: string | null;
};

type InstagramPublishOptions = {
  postPlatformId: string;
  instagramId: string;
};

type InstagramPlatformMetadata = {
  provider: 'instagram';
  instagramId: string;
};

type LinkedInPublishOptions = {
  postPlatformId: string;
  link?: string | null;
};

type LinkedInPlatformMetadata = {
  provider: 'linkedin';
  link?: string | null;
};

type LinkedInOrganizationPublishOptions = {
  postPlatformId: string;
  organizationId: string;
  link?: string | null;
};

type LinkedInOrganizationPlatformMetadata = {
  provider: 'linkedin_organization';
  organizationId: string;
  link?: string | null;
};

type ThreadPublishOptions = {
  postPlatformId: string;
};

type ThreadPlatformMetadata = {
  provider: 'thread';
};

type PlatformMetadata =
  | GooglePlatformMetadata
  | PinterestPlatformMetadata
  | FacebookPlatformMetadata
  | InstagramPlatformMetadata
  | LinkedInPlatformMetadata
  | LinkedInOrganizationPlatformMetadata
  | ThreadPlatformMetadata;

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
    private readonly pinterestService: PinterestService,
    private readonly metaService: MetaService,
    private readonly linkedInService: LinkedInService,
    private readonly threadsService: ThreadsService,
    private readonly socialAccountsService: SocialAccountsService,
  ) {}

  /**
   * Uploads media to S3, saves post + platform rows in DB.
   * - draft: returns immediately with no background work
   * - scheduled: saves as Scheduled (cron publishes later), returns immediately
   * - publish: background publish + Pusher notification
   */
  async create(
    userId: string,
    dto: CreatePostDto,
    files: UploadedMediaFile[] = [],
  ) {
    const postStatus = dto.postStatus;
    const googlePost = dto.googlePost === true;
    const pinterestPost = dto.pinterestPost === true;
    const facebookPost = dto.facebookPost === true;
    const instagramPost = dto.instagramPost === true;
    const linkedinPost = dto.linkedinPost === true;
    const linkedinOrganizationPost = dto.linkedinOrganizationPost === true;
    const threadPost = dto.threadPost === true;
    let googleSocialAccountId: string | null = null;
    let pinterestSocialAccountId: string | null = null;
    let metaSocialAccountId: string | null = null;
    let linkedinSocialAccountId: string | null = null;
    let threadSocialAccountId: string | null = null;

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

    if (pinterestPost) {
      const pinterestAccount =
        await this.socialAccountsService.findActiveByUserAndPlatform(
          userId,
          'pinterest',
        );
      pinterestSocialAccountId = pinterestAccount.id;

      const hasImage = files.some((file) =>
        file.mimetype.startsWith('image/'),
      );
      if (!hasImage) {
        throw new BadRequestException(
          'At least one image file is required when pinterestPost is true',
        );
      }
    }

    if (facebookPost || instagramPost) {
      const metaAccount =
        await this.socialAccountsService.findActiveByUserAndPlatform(
          userId,
          'meta',
        );
      metaSocialAccountId = metaAccount.id;
    }

    let resolvedInstagramId: string | null = null;
    if (instagramPost) {
      resolvedInstagramId =
        await this.metaService.getConnectedInstagramIdForUser(userId);

      const hasMedia = files.some(
        (file) =>
          file.mimetype.startsWith('image/') ||
          file.mimetype.startsWith('video/'),
      );
      if (!hasMedia) {
        throw new BadRequestException(
          'At least one image or video file is required when instagramPost is true',
        );
      }
    }

    if (linkedinPost || linkedinOrganizationPost) {
      const linkedinAccount =
        await this.socialAccountsService.findActiveByUserAndPlatform(
          userId,
          'linkedin',
        );
      linkedinSocialAccountId = linkedinAccount.id;

      const hasImage = files.some((file) =>
        file.mimetype.startsWith('image/'),
      );
      if (
        !dto.caption?.trim() &&
        !dto.title?.trim() &&
        !dto.linkedinLink?.trim() &&
        !hasImage
      ) {
        throw new BadRequestException(
          'caption, title, linkedinLink, or an image is required for LinkedIn posts',
        );
      }
    }

    if (threadPost) {
      const threadAccount =
        await this.socialAccountsService.findActiveByUserAndPlatform(
          userId,
          'thread',
        );
      threadSocialAccountId = threadAccount.id;

      const hasMedia = files.some(
        (file) =>
          file.mimetype.startsWith('image/') ||
          file.mimetype.startsWith('video/'),
      );
      if (!dto.caption?.trim() && !dto.title?.trim() && !hasMedia) {
        throw new BadRequestException(
          'caption, title, or media is required when threadPost is true',
        );
      }
    }

    let scheduledAt: Date | null = null;
    if (postStatus === CreatePostStatus.SCHEDULED) {
      if (!dto.scheduledAt?.trim()) {
        throw new BadRequestException(
          'scheduledAt is required when postStatus is Scheduled',
        );
      }
      scheduledAt = new Date(dto.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime())) {
        throw new BadRequestException('scheduledAt must be a valid date');
      }
      if (scheduledAt.getTime() <= Date.now()) {
        throw new BadRequestException('scheduledAt must be in the future');
      }
    }

    const initialStatus =
      postStatus === CreatePostStatus.DRAFT
        ? PostStatus.DRAFT
        : postStatus === CreatePostStatus.SCHEDULED
          ? PostStatus.SCHEDULED
          : PostStatus.PUBLISHING;

    const post = await this.postsRepository.save(
      this.postsRepository.create({
        userId,
        title: dto.title?.trim() || null,
        caption: dto.caption?.trim() || null,
        scheduledAt,
        status: initialStatus,
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
    let pinterestOptions: PinterestPublishOptions | null = null;
    let facebookOptions: FacebookPublishOptions | null = null;
    let instagramOptions: InstagramPublishOptions | null = null;
    let linkedinOptions: LinkedInPublishOptions | null = null;
    let linkedinOrganizationOptions: LinkedInOrganizationPublishOptions | null =
      null;
    let threadOptions: ThreadPublishOptions | null = null;

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

    if (pinterestPost && pinterestSocialAccountId) {
      const metadata: PinterestPlatformMetadata = {
        provider: 'pinterest',
        boardId: dto.pinterestBoardId!,
        link: dto.pinterestLink?.trim() || null,
      };

      const postPlatform = await this.postPlatformRepository.save(
        this.postPlatformRepository.create({
          postId: post.id,
          socialAccountId: pinterestSocialAccountId,
          socialPageId: null,
          platformStatus: PlatformPostStatus.PENDING,
          platformPostId: null,
          publishedAt: null,
          errorMessage: null,
          metadata,
        }),
      );

      pinterestOptions = {
        postPlatformId: postPlatform.id,
        boardId: metadata.boardId,
        link: metadata.link,
      };
    }

    if (facebookPost && metaSocialAccountId) {
      const metadata: FacebookPlatformMetadata = {
        provider: 'facebook',
        pageId: dto.facebookPageId!,
        link: dto.facebookLink?.trim() || null,
      };

      const postPlatform = await this.postPlatformRepository.save(
        this.postPlatformRepository.create({
          postId: post.id,
          socialAccountId: metaSocialAccountId,
          socialPageId: null,
          platformStatus: PlatformPostStatus.PENDING,
          platformPostId: null,
          publishedAt: null,
          errorMessage: null,
          metadata,
        }),
      );

      facebookOptions = {
        postPlatformId: postPlatform.id,
        pageId: metadata.pageId,
        link: metadata.link,
      };
    }

    if (instagramPost && metaSocialAccountId && resolvedInstagramId) {
      const metadata: InstagramPlatformMetadata = {
        provider: 'instagram',
        instagramId: resolvedInstagramId,
      };

      const postPlatform = await this.postPlatformRepository.save(
        this.postPlatformRepository.create({
          postId: post.id,
          socialAccountId: metaSocialAccountId,
          socialPageId: null,
          platformStatus: PlatformPostStatus.PENDING,
          platformPostId: null,
          publishedAt: null,
          errorMessage: null,
          metadata,
        }),
      );

      instagramOptions = {
        postPlatformId: postPlatform.id,
        instagramId: metadata.instagramId,
      };
    }

    if (linkedinPost && linkedinSocialAccountId) {
      const metadata: LinkedInPlatformMetadata = {
        provider: 'linkedin',
        link: dto.linkedinLink?.trim() || null,
      };

      const postPlatform = await this.postPlatformRepository.save(
        this.postPlatformRepository.create({
          postId: post.id,
          socialAccountId: linkedinSocialAccountId,
          socialPageId: null,
          platformStatus: PlatformPostStatus.PENDING,
          platformPostId: null,
          publishedAt: null,
          errorMessage: null,
          metadata,
        }),
      );

      linkedinOptions = {
        postPlatformId: postPlatform.id,
        link: metadata.link,
      };
    }

    if (linkedinOrganizationPost && linkedinSocialAccountId) {
      const metadata: LinkedInOrganizationPlatformMetadata = {
        provider: 'linkedin_organization',
        organizationId: dto.linkedinOrganizationId!,
        link: dto.linkedinLink?.trim() || null,
      };

      const postPlatform = await this.postPlatformRepository.save(
        this.postPlatformRepository.create({
          postId: post.id,
          socialAccountId: linkedinSocialAccountId,
          socialPageId: null,
          platformStatus: PlatformPostStatus.PENDING,
          platformPostId: null,
          publishedAt: null,
          errorMessage: null,
          metadata,
        }),
      );

      linkedinOrganizationOptions = {
        postPlatformId: postPlatform.id,
        organizationId: metadata.organizationId,
        link: metadata.link,
      };
    }

    if (threadPost && threadSocialAccountId) {
      const metadata: ThreadPlatformMetadata = {
        provider: 'thread',
      };

      const postPlatform = await this.postPlatformRepository.save(
        this.postPlatformRepository.create({
          postId: post.id,
          socialAccountId: threadSocialAccountId,
          socialPageId: null,
          platformStatus: PlatformPostStatus.PENDING,
          platformPostId: null,
          publishedAt: null,
          errorMessage: null,
          metadata,
        }),
      );

      threadOptions = {
        postPlatformId: postPlatform.id,
      };
    }

    if (postStatus === CreatePostStatus.PUBLISHING) {
      setImmediate(() => {
        void this.processCreateInBackground(post.id, userId, {
          google: googleOptions,
          pinterest: pinterestOptions,
          facebook: facebookOptions,
          instagram: instagramOptions,
          linkedin: linkedinOptions,
          linkedinOrganization: linkedinOrganizationOptions,
          thread: threadOptions,
        });
      });

      this.logger.log(
        `Post publish accepted; background processing started postId=${post.id} user=${userId}`,
      );

      return {
        message: 'Post is processing',
        status: PostStatus.PUBLISHING,
        postId: post.id,
        channel: userPrivateChannel(userId),
        event: PUSHER_EVENTS.POST_PROCESSED,
        googlePost,
        pinterestPost,
        facebookPost,
        instagramPost,
        linkedinPost,
        linkedinOrganizationPost,
        threadPost,
      };
    }

    if (postStatus === CreatePostStatus.SCHEDULED) {
      this.logger.log(
        `Post scheduled postId=${post.id} user=${userId} scheduledAt=${scheduledAt?.toISOString()}`,
      );

      return {
        message: 'Post scheduled successfully',
        status: PostStatus.SCHEDULED,
        postId: post.id,
        scheduledAt,
        googlePost,
        pinterestPost,
        facebookPost,
        instagramPost,
        linkedinPost,
        linkedinOrganizationPost,
        threadPost,
      };
    }

    this.logger.log(`Post draft saved postId=${post.id} user=${userId}`);

    return {
      message: 'Post created successfully',
      status: PostStatus.DRAFT,
      postId: post.id,
      googlePost,
      pinterestPost,
      facebookPost,
      instagramPost,
      linkedinPost,
      linkedinOrganizationPost,
      threadPost,
    };
  }

  async findAllForUser(
    userId: string,
    options: { page?: number; limit?: number } = {},
  ) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const skip = (page - 1) * limit;

    const total = await this.postsRepository.count({ where: { userId } });
    const posts = await this.postsRepository.find({
      where: { userId },
      relations: { media: true, platforms: true },
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      posts: posts.map((post) => this.toPostResponse(post)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async findOneForUser(userId: string, postId: string) {
    const post = await this.postsRepository.findOne({
      where: { id: postId, userId },
      relations: { media: true, platforms: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    return this.toPostResponse(post);
  }

  async deleteForUser(userId: string, postId: string) {
    const post = await this.postsRepository.findOne({
      where: { id: postId, userId },
      relations: { media: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    const mediaUrls = (post.media ?? [])
      .map((item) => item.url)
      .filter((url) => url.trim().length > 0);

    if (this.s3Service.isEnabled()) {
      for (const url of mediaUrls) {
        try {
          await this.s3Service.deleteByUrl(url);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            `Failed to delete S3 media for postId=${postId} url=${url}: ${message}`,
          );
        }
      }
    }

    await this.postsRepository.delete({ id: postId, userId });

    this.logger.log(`Post deleted postId=${postId} user=${userId}`);

    return {
      message: 'Post deleted successfully',
      postId,
    };
  }

  /**
   * Publishes an existing draft post: returns immediately, then publishes in background
   * and notifies via Pusher (same flow as create with postStatus=Publishing).
   */
  async publishDraft(userId: string, postId: string) {
    const post = await this.postsRepository.findOne({
      where: { id: postId, userId },
      relations: { platforms: true },
    });

    if (!post) {
      throw new NotFoundException('Post not found');
    }

    if (post.status !== PostStatus.DRAFT) {
      throw new BadRequestException('Only draft posts can be published');
    }

    const platforms = post.platforms ?? [];
    if (!platforms.length) {
      throw new BadRequestException(
        'Post has no platforms configured to publish',
      );
    }

    const publishOptions = this.buildPublishOptionsFromPlatforms(platforms);

    post.status = PostStatus.PUBLISHING;
    post.publishedAt = null;
    await this.postsRepository.save(post);

    setImmediate(() => {
      void this.processCreateInBackground(post.id, userId, publishOptions);
    });

    this.logger.log(
      `Draft publish accepted; background processing started postId=${post.id} user=${userId}`,
    );

    return {
      message: 'Post is processing',
      status: PostStatus.PUBLISHING,
      postId: post.id,
      channel: userPrivateChannel(userId),
      event: PUSHER_EVENTS.POST_PROCESSED,
      googlePost: publishOptions.google !== null,
      pinterestPost: publishOptions.pinterest !== null,
      facebookPost: publishOptions.facebook !== null,
      instagramPost: publishOptions.instagram !== null,
      linkedinPost: publishOptions.linkedin !== null,
      linkedinOrganizationPost: publishOptions.linkedinOrganization !== null,
      threadPost: publishOptions.thread !== null,
    };
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
        const pinterestResults: Record<string, unknown>[] = [];
        const facebookResults: Record<string, unknown>[] = [];
        const instagramResults: Record<string, unknown>[] = [];
        const linkedinResults: Record<string, unknown>[] = [];
        const linkedinOrganizationResults: Record<string, unknown>[] = [];
        const threadResults: Record<string, unknown>[] = [];

        for (const platform of pendingPlatforms) {
          const meta = platform.metadata as PlatformMetadata | null;
          if (!meta?.provider) {
            continue;
          }

          if (meta.provider === 'google') {
            googleResults.push(
              await this.publishGoogleBusinessPost(post.userId, post, {
                postPlatformId: platform.id,
                accountId: meta.accountId,
                locationId: meta.locationId,
                actionType: meta.actionType,
                ctaUrl: meta.ctaUrl ?? null,
              }),
            );
          } else if (meta.provider === 'pinterest') {
            pinterestResults.push(
              await this.publishPinterestPin(post.userId, post, {
                postPlatformId: platform.id,
                boardId: meta.boardId,
                link: meta.link ?? null,
              }),
            );
          } else if (meta.provider === 'facebook') {
            facebookResults.push(
              await this.publishFacebookPagePost(post.userId, post, {
                postPlatformId: platform.id,
                pageId: meta.pageId,
                link: meta.link ?? null,
              }),
            );
          } else if (meta.provider === 'instagram') {
            instagramResults.push(
              await this.publishInstagramPost(post.userId, post, {
                postPlatformId: platform.id,
                instagramId: meta.instagramId,
              }),
            );
          } else if (meta.provider === 'linkedin') {
            linkedinResults.push(
              await this.publishLinkedInAccountPost(post.userId, post, {
                postPlatformId: platform.id,
                link: meta.link ?? null,
              }),
            );
          } else if (meta.provider === 'linkedin_organization') {
            linkedinOrganizationResults.push(
              await this.publishLinkedInOrganizationPost(post.userId, post, {
                postPlatformId: platform.id,
                organizationId: meta.organizationId,
                link: meta.link ?? null,
              }),
            );
          } else if (meta.provider === 'thread') {
            threadResults.push(
              await this.publishThreadsPost(post.userId, post, {
                postPlatformId: platform.id,
              }),
            );
          }
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
            pinterest: pinterestResults[0] ?? null,
            pinterestResults,
            facebook: facebookResults[0] ?? null,
            facebookResults,
            instagram: instagramResults[0] ?? null,
            instagramResults,
            linkedin: linkedinResults[0] ?? null,
            linkedinResults,
            linkedinOrganization: linkedinOrganizationResults[0] ?? null,
            linkedinOrganizationResults,
            thread: threadResults[0] ?? null,
            threadResults,
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
    options: {
      google: GooglePublishOptions | null;
      pinterest: PinterestPublishOptions | null;
      facebook: FacebookPublishOptions | null;
      instagram: InstagramPublishOptions | null;
      linkedin: LinkedInPublishOptions | null;
      linkedinOrganization: LinkedInOrganizationPublishOptions | null;
      thread: ThreadPublishOptions | null;
    },
  ) {
    this.logger.log(`Background processing postId=${postId}`);

    try {
      const post = await this.finalizeCreateProcessing(postId, userId);
      let googleResult: Record<string, unknown> | null = null;
      let pinterestResult: Record<string, unknown> | null = null;
      let facebookResult: Record<string, unknown> | null = null;
      let instagramResult: Record<string, unknown> | null = null;
      let linkedinResult: Record<string, unknown> | null = null;
      let linkedinOrganizationResult: Record<string, unknown> | null = null;
      let threadResult: Record<string, unknown> | null = null;

      if (options.google) {
        googleResult = await this.publishGoogleBusinessPost(
          userId,
          post,
          options.google,
        );
      }
      if (options.pinterest) {
        pinterestResult = await this.publishPinterestPin(
          userId,
          post,
          options.pinterest,
        );
      }
      if (options.facebook) {
        facebookResult = await this.publishFacebookPagePost(
          userId,
          post,
          options.facebook,
        );
      }
      if (options.instagram) {
        instagramResult = await this.publishInstagramPost(
          userId,
          post,
          options.instagram,
        );
      }
      if (options.linkedin) {
        linkedinResult = await this.publishLinkedInAccountPost(
          userId,
          post,
          options.linkedin,
        );
      }
      if (options.linkedinOrganization) {
        linkedinOrganizationResult =
          await this.publishLinkedInOrganizationPost(
            userId,
            post,
            options.linkedinOrganization,
          );
      }
      if (options.thread) {
        threadResult = await this.publishThreadsPost(
          userId,
          post,
          options.thread,
        );
      }

      const platforms = await this.postPlatformRepository.find({
        where: { postId },
      });

      if (post.status === PostStatus.PUBLISHING) {
        const anyFailed = platforms.some(
          (p) => p.platformStatus === PlatformPostStatus.FAILED,
        );
        const anyPublished = platforms.some(
          (p) => p.platformStatus === PlatformPostStatus.PUBLISHED,
        );

        if (anyPublished) {
          post.status = PostStatus.PUBLISHED;
          post.publishedAt = new Date();
        } else if (anyFailed) {
          post.status = PostStatus.FAILED;
        } else {
          post.status = PostStatus.PUBLISHED;
          post.publishedAt = new Date();
        }

        await this.postsRepository.save(post);
      }

      await this.pusherService.triggerUserEvent(
        userId,
        PUSHER_EVENTS.POST_PROCESSED,
        {
          postId: post.id,
          status: post.status,
          message: 'Post processing completed',
          channel: userPrivateChannel(userId),
          google: googleResult,
          pinterest: pinterestResult,
          facebook: facebookResult,
          instagram: instagramResult,
          linkedin: linkedinResult,
          linkedinOrganization: linkedinOrganizationResult,
          thread: threadResult,
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

  private async publishPinterestPin(
    userId: string,
    post: Post,
    options: PinterestPublishOptions,
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

    if (post.status === PostStatus.SCHEDULED) {
      this.logger.log(
        `Skipping Pinterest publish for scheduled postId=${post.id}; leaving PostPlatform Pending`,
      );
      return {
        status: PlatformPostStatus.PENDING,
        skipped: true,
        reason: 'scheduled_for_later',
      };
    }

    postPlatform.platformStatus = PlatformPostStatus.PUBLISHING;
    await this.postPlatformRepository.save(postPlatform);

    const imageUrls = (post.media ?? [])
      .filter((item) => item.type !== PostMediaType.VIDEO)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.url);

    if (!imageUrls.length) {
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage =
        'Pinterest requires at least one image (video-only pins are not supported yet)';
      await this.postPlatformRepository.save(postPlatform);
      return {
        status: PlatformPostStatus.FAILED,
        error: postPlatform.errorMessage,
      };
    }

    try {
      const created = await this.pinterestService.createPinForUser(userId, {
        boardId: options.boardId,
        title: post.title,
        description: post.caption,
        link: options.link,
        imageUrls,
      });

      postPlatform.platformStatus = PlatformPostStatus.PUBLISHED;
      postPlatform.platformPostId = created.pinId;
      postPlatform.publishedAt = new Date();
      postPlatform.errorMessage = null;
      await this.postPlatformRepository.save(postPlatform);

      return {
        status: PlatformPostStatus.PUBLISHED,
        platformPostId: postPlatform.platformPostId,
        boardId: options.boardId,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Pinterest pin publish failed postId=${post.id}: ${message}`,
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

  private async publishFacebookPagePost(
    userId: string,
    post: Post,
    options: FacebookPublishOptions,
  ): Promise<Record<string, unknown>> {
    const postPlatform = await this.postPlatformRepository.findOne({
      where: { id: options.postPlatformId },
    });

    if (!postPlatform) {
      return { status: 'Failed', error: 'Post platform row not found' };
    }

    if (post.status === PostStatus.SCHEDULED) {
      return {
        status: PlatformPostStatus.PENDING,
        skipped: true,
        reason: 'scheduled_for_later',
      };
    }

    postPlatform.platformStatus = PlatformPostStatus.PUBLISHING;
    await this.postPlatformRepository.save(postPlatform);

    const imageUrls = (post.media ?? [])
      .filter((item) => item.type !== PostMediaType.VIDEO)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.url);
    const videoUrl = (post.media ?? []).find(
      (item) => item.type === PostMediaType.VIDEO,
    )?.url;

    const message = (post.caption?.trim() || post.title?.trim() || '').trim();

    try {
      const created = await this.metaService.createPagePostForUser(
        userId,
        options.pageId,
        {
          message: message || null,
          link: options.link,
          imageUrls: videoUrl ? undefined : imageUrls,
          videoUrl: videoUrl ?? null,
        },
      );

      postPlatform.platformStatus = PlatformPostStatus.PUBLISHED;
      postPlatform.platformPostId = created.postId;
      postPlatform.publishedAt = new Date();
      postPlatform.errorMessage = null;
      await this.postPlatformRepository.save(postPlatform);

      return {
        status: PlatformPostStatus.PUBLISHED,
        platformPostId: postPlatform.platformPostId,
        pageId: options.pageId,
        kind: created.kind,
      };
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Facebook page publish failed postId=${post.id}: ${messageText}`,
      );
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage = messageText;
      await this.postPlatformRepository.save(postPlatform);
      return { status: PlatformPostStatus.FAILED, error: messageText };
    }
  }

  private async publishInstagramPost(
    userId: string,
    post: Post,
    options: InstagramPublishOptions,
  ): Promise<Record<string, unknown>> {
    const postPlatform = await this.postPlatformRepository.findOne({
      where: { id: options.postPlatformId },
    });

    if (!postPlatform) {
      return { status: 'Failed', error: 'Post platform row not found' };
    }

    if (post.status === PostStatus.SCHEDULED) {
      return {
        status: PlatformPostStatus.PENDING,
        skipped: true,
        reason: 'scheduled_for_later',
      };
    }

    postPlatform.platformStatus = PlatformPostStatus.PUBLISHING;
    await this.postPlatformRepository.save(postPlatform);

    const imageUrls = (post.media ?? [])
      .filter((item) => item.type !== PostMediaType.VIDEO)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.url);
    const videoUrl = (post.media ?? []).find(
      (item) => item.type === PostMediaType.VIDEO,
    )?.url;

    if (!imageUrls.length && !videoUrl) {
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage =
        'Instagram requires at least one image or video';
      await this.postPlatformRepository.save(postPlatform);
      return {
        status: PlatformPostStatus.FAILED,
        error: postPlatform.errorMessage,
      };
    }

    try {
      const created = await this.metaService.createInstagramPostForUser(
        userId,
        options.instagramId,
        {
          caption: post.caption?.trim() || post.title?.trim() || null,
          imageUrls: imageUrls.length ? imageUrls : undefined,
          videoUrl: imageUrls.length ? undefined : (videoUrl ?? null),
        },
      );

      postPlatform.platformStatus = PlatformPostStatus.PUBLISHED;
      postPlatform.platformPostId = created.postId;
      postPlatform.publishedAt = new Date();
      postPlatform.errorMessage = null;
      await this.postPlatformRepository.save(postPlatform);

      return {
        status: PlatformPostStatus.PUBLISHED,
        platformPostId: postPlatform.platformPostId,
        instagramId: options.instagramId,
        kind: created.kind,
      };
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Instagram publish failed postId=${post.id}: ${messageText}`,
      );
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage = messageText;
      await this.postPlatformRepository.save(postPlatform);
      return { status: PlatformPostStatus.FAILED, error: messageText };
    }
  }

  private async publishLinkedInAccountPost(
    userId: string,
    post: Post,
    options: LinkedInPublishOptions,
  ): Promise<Record<string, unknown>> {
    const postPlatform = await this.postPlatformRepository.findOne({
      where: { id: options.postPlatformId },
    });

    if (!postPlatform) {
      return { status: 'Failed', error: 'Post platform row not found' };
    }

    if (post.status === PostStatus.SCHEDULED) {
      return {
        status: PlatformPostStatus.PENDING,
        skipped: true,
        reason: 'scheduled_for_later',
      };
    }

    postPlatform.platformStatus = PlatformPostStatus.PUBLISHING;
    await this.postPlatformRepository.save(postPlatform);

    const commentary = (post.caption?.trim() || post.title?.trim() || '').trim();
    const imageUrls = (post.media ?? [])
      .filter((item) => item.type !== PostMediaType.VIDEO)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.url);

    try {
      const created = await this.linkedInService.accountPostForUser(userId, {
        commentary: commentary || null,
        imageUrls,
        link: options.link,
      });

      postPlatform.platformStatus = PlatformPostStatus.PUBLISHED;
      postPlatform.platformPostId = created.postId;
      postPlatform.publishedAt = new Date();
      postPlatform.errorMessage = null;
      await this.postPlatformRepository.save(postPlatform);

      return {
        status: PlatformPostStatus.PUBLISHED,
        platformPostId: postPlatform.platformPostId,
        author: created.author,
      };
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `LinkedIn account publish failed postId=${post.id}: ${messageText}`,
      );
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage = messageText;
      await this.postPlatformRepository.save(postPlatform);
      return { status: PlatformPostStatus.FAILED, error: messageText };
    }
  }

  private async publishLinkedInOrganizationPost(
    userId: string,
    post: Post,
    options: LinkedInOrganizationPublishOptions,
  ): Promise<Record<string, unknown>> {
    const postPlatform = await this.postPlatformRepository.findOne({
      where: { id: options.postPlatformId },
    });

    if (!postPlatform) {
      return { status: 'Failed', error: 'Post platform row not found' };
    }

    if (post.status === PostStatus.SCHEDULED) {
      return {
        status: PlatformPostStatus.PENDING,
        skipped: true,
        reason: 'scheduled_for_later',
      };
    }

    postPlatform.platformStatus = PlatformPostStatus.PUBLISHING;
    await this.postPlatformRepository.save(postPlatform);

    const commentary = (post.caption?.trim() || post.title?.trim() || '').trim();
    const imageUrls = (post.media ?? [])
      .filter((item) => item.type !== PostMediaType.VIDEO)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.url);

    try {
      const created = await this.linkedInService.pagePostForUser(
        userId,
        options.organizationId,
        {
          commentary: commentary || null,
          imageUrls,
          link: options.link,
        },
      );

      postPlatform.platformStatus = PlatformPostStatus.PUBLISHED;
      postPlatform.platformPostId = created.postId;
      postPlatform.publishedAt = new Date();
      postPlatform.errorMessage = null;
      await this.postPlatformRepository.save(postPlatform);

      return {
        status: PlatformPostStatus.PUBLISHED,
        platformPostId: postPlatform.platformPostId,
        organizationId: options.organizationId,
        author: created.author,
      };
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `LinkedIn organization publish failed postId=${post.id}: ${messageText}`,
      );
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage = messageText;
      await this.postPlatformRepository.save(postPlatform);
      return { status: PlatformPostStatus.FAILED, error: messageText };
    }
  }

  private async publishThreadsPost(
    userId: string,
    post: Post,
    options: ThreadPublishOptions,
  ): Promise<Record<string, unknown>> {
    const postPlatform = await this.postPlatformRepository.findOne({
      where: { id: options.postPlatformId },
    });

    if (!postPlatform) {
      return { status: 'Failed', error: 'Post platform row not found' };
    }

    if (post.status === PostStatus.SCHEDULED) {
      return {
        status: PlatformPostStatus.PENDING,
        skipped: true,
        reason: 'scheduled_for_later',
      };
    }

    postPlatform.platformStatus = PlatformPostStatus.PUBLISHING;
    await this.postPlatformRepository.save(postPlatform);

    const text = (post.caption?.trim() || post.title?.trim() || '').trim();
    const imageUrls = (post.media ?? [])
      .filter((item) => item.type !== PostMediaType.VIDEO)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.url);
    const videoUrl = (post.media ?? []).find(
      (item) => item.type === PostMediaType.VIDEO,
    )?.url;

    try {
      const created = await this.threadsService.createPostForUser(userId, {
        text: text || null,
        imageUrls: imageUrls.length ? imageUrls : undefined,
        videoUrl: imageUrls.length ? undefined : (videoUrl ?? null),
      });

      postPlatform.platformStatus = PlatformPostStatus.PUBLISHED;
      postPlatform.platformPostId = created.postId;
      postPlatform.publishedAt = new Date();
      postPlatform.errorMessage = null;
      await this.postPlatformRepository.save(postPlatform);

      return {
        status: PlatformPostStatus.PUBLISHED,
        platformPostId: postPlatform.platformPostId,
        creationId: created.creationId,
      };
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Threads publish failed postId=${post.id}: ${messageText}`,
      );
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage = messageText;
      await this.postPlatformRepository.save(postPlatform);
      return { status: PlatformPostStatus.FAILED, error: messageText };
    }
  }

  private buildPublishOptionsFromPlatforms(platforms: PostPlatform[]): {
    google: GooglePublishOptions | null;
    pinterest: PinterestPublishOptions | null;
    facebook: FacebookPublishOptions | null;
    instagram: InstagramPublishOptions | null;
    linkedin: LinkedInPublishOptions | null;
    linkedinOrganization: LinkedInOrganizationPublishOptions | null;
    thread: ThreadPublishOptions | null;
  } {
    let google: GooglePublishOptions | null = null;
    let pinterest: PinterestPublishOptions | null = null;
    let facebook: FacebookPublishOptions | null = null;
    let instagram: InstagramPublishOptions | null = null;
    let linkedin: LinkedInPublishOptions | null = null;
    let linkedinOrganization: LinkedInOrganizationPublishOptions | null = null;
    let thread: ThreadPublishOptions | null = null;

    for (const platform of platforms) {
      const meta = platform.metadata as PlatformMetadata | null;
      if (!meta?.provider) {
        continue;
      }

      if (meta.provider === 'google') {
        google = {
          postPlatformId: platform.id,
          accountId: meta.accountId,
          locationId: meta.locationId,
          actionType: meta.actionType,
          ctaUrl: meta.ctaUrl ?? null,
        };
      } else if (meta.provider === 'pinterest') {
        pinterest = {
          postPlatformId: platform.id,
          boardId: meta.boardId,
          link: meta.link ?? null,
        };
      } else if (meta.provider === 'facebook') {
        facebook = {
          postPlatformId: platform.id,
          pageId: meta.pageId,
          link: meta.link ?? null,
        };
      } else if (meta.provider === 'instagram') {
        instagram = {
          postPlatformId: platform.id,
          instagramId: meta.instagramId,
        };
      } else if (meta.provider === 'linkedin') {
        linkedin = {
          postPlatformId: platform.id,
          link: meta.link ?? null,
        };
      } else if (meta.provider === 'linkedin_organization') {
        linkedinOrganization = {
          postPlatformId: platform.id,
          organizationId: meta.organizationId,
          link: meta.link ?? null,
        };
      } else if (meta.provider === 'thread') {
        thread = {
          postPlatformId: platform.id,
        };
      }
    }

    return {
      google,
      pinterest,
      facebook,
      instagram,
      linkedin,
      linkedinOrganization,
      thread,
    };
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

    if (post.status === PostStatus.PUBLISHING) {
      return post;
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

  /** Plain response object — avoids circular Post ↔ media/platforms JSON. */
  private toPostResponse(post: Post) {
    return {
      id: post.id,
      title: post.title ?? null,
      caption: post.caption ?? null,
      status: post.status,
      scheduledAt: post.scheduledAt ?? null,
      publishedAt: post.publishedAt ?? null,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      media: (post.media ?? [])
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((item) => ({
          id: item.id,
          type: item.type,
          url: item.url,
          order: item.order,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        })),
      platforms: (post.platforms ?? []).map((item) => ({
        id: item.id,
        socialAccountId: item.socialAccountId,
        socialPageId: item.socialPageId ?? null,
        platformStatus: item.platformStatus,
        platformPostId: item.platformPostId ?? null,
        publishedAt: item.publishedAt ?? null,
        errorMessage: item.errorMessage ?? null,
        metadata: item.metadata ?? null,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      })),
    };
  }
}
