import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { And, LessThan, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
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
  SnapchatPostType,
} from '../posts/dto/create-post.dto';
import { PostsAnalyticsRange } from '../posts/dto/posts-analytics-query.dto';
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
import { SnapchatService } from './snapchat.service';
import { SocialAccountsService } from './social-accounts.service';
import { ThreadsService } from './threads.service';
import { TikTokService } from './tiktok.service';
import { XService } from './x.service';

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

type TikTokPublishOptions = {
  postPlatformId: string;
};

type TikTokPlatformMetadata = {
  provider: 'tiktok';
};

type SnapchatPublishOptions = {
  postPlatformId: string;
  postType: SnapchatPostType;
  profileId?: string | null;
};

type SnapchatPlatformMetadata = {
  provider: 'snapchat';
  postType: SnapchatPostType;
  profileId?: string | null;
};

type XPublishOptions = {
  postPlatformId: string;
};

type XPlatformMetadata = {
  provider: 'x';
};

type PlatformMetadata =
  | GooglePlatformMetadata
  | PinterestPlatformMetadata
  | FacebookPlatformMetadata
  | InstagramPlatformMetadata
  | LinkedInPlatformMetadata
  | LinkedInOrganizationPlatformMetadata
  | ThreadPlatformMetadata
  | TikTokPlatformMetadata
  | SnapchatPlatformMetadata
  | XPlatformMetadata;

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
    private readonly tiktokService: TikTokService,
    private readonly snapchatService: SnapchatService,
    private readonly xService: XService,
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
    const tiktokPost = dto.tiktokPost === true;
    const snapchatPost = dto.snapchatPost === true;
    const xPost = dto.xPost === true;
    let googleSocialAccountId: string | null = null;
    let pinterestSocialAccountId: string | null = null;
    let metaSocialAccountId: string | null = null;
    let linkedinSocialAccountId: string | null = null;
    let threadSocialAccountId: string | null = null;
    let tiktokSocialAccountId: string | null = null;
    let snapchatSocialAccountId: string | null = null;
    let xSocialAccountId: string | null = null;

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

    if (tiktokPost) {
      const tiktokAccount =
        await this.socialAccountsService.findActiveByUserAndPlatform(
          userId,
          'tiktok',
        );
      tiktokSocialAccountId = tiktokAccount.id;

      const hasMedia = files.some(
        (file) =>
          file.mimetype.startsWith('image/') ||
          file.mimetype.startsWith('video/'),
      );
      if (!hasMedia) {
        throw new BadRequestException(
          'At least one image or video file is required when tiktokPost is true',
        );
      }
    }

    if (snapchatPost) {
      const snapchatAccount =
        await this.socialAccountsService.findActiveByUserAndPlatform(
          userId,
          'snapchat',
        );
      snapchatSocialAccountId = snapchatAccount.id;

      if (!dto.snapchatPostType) {
        throw new BadRequestException(
          'snapchatPostType is required when snapchatPost is true',
        );
      }

      if (dto.snapchatPostType === 'SPOTLIGHT') {
        const hasVideo = files.some((file) =>
          file.mimetype.startsWith('video/'),
        );
        if (!hasVideo) {
          throw new BadRequestException(
            'At least one video file is required for Snapchat Spotlight posts',
          );
        }
      } else {
        const hasMedia = files.some(
          (file) =>
            file.mimetype.startsWith('image/') ||
            file.mimetype.startsWith('video/'),
        );
        if (!hasMedia) {
          throw new BadRequestException(
            'At least one image or video file is required when snapchatPost is true',
          );
        }
      }
    }

    if (xPost) {
      const xAccount =
        await this.socialAccountsService.findActiveByUserAndPlatform(
          userId,
          'x',
        );
      xSocialAccountId = xAccount.id;

      const hasMedia = files.some(
        (file) =>
          file.mimetype.startsWith('image/') ||
          file.mimetype.startsWith('video/'),
      );
      if (!dto.caption?.trim() && !dto.title?.trim() && !hasMedia) {
        throw new BadRequestException(
          'caption, title, or media is required when xPost is true',
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
    let tiktokOptions: TikTokPublishOptions | null = null;
    let snapchatOptions: SnapchatPublishOptions | null = null;
    let xOptions: XPublishOptions | null = null;

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

    if (tiktokPost && tiktokSocialAccountId) {
      const metadata: TikTokPlatformMetadata = {
        provider: 'tiktok',
      };

      const postPlatform = await this.postPlatformRepository.save(
        this.postPlatformRepository.create({
          postId: post.id,
          socialAccountId: tiktokSocialAccountId,
          socialPageId: null,
          platformStatus: PlatformPostStatus.PENDING,
          platformPostId: null,
          publishedAt: null,
          errorMessage: null,
          metadata,
        }),
      );

      tiktokOptions = {
        postPlatformId: postPlatform.id,
      };
    }

    if (snapchatPost && snapchatSocialAccountId) {
      const metadata: SnapchatPlatformMetadata = {
        provider: 'snapchat',
        postType: dto.snapchatPostType!,
        profileId: dto.snapchatProfileId?.trim() || null,
      };

      const postPlatform = await this.postPlatformRepository.save(
        this.postPlatformRepository.create({
          postId: post.id,
          socialAccountId: snapchatSocialAccountId,
          socialPageId: null,
          platformStatus: PlatformPostStatus.PENDING,
          platformPostId: null,
          publishedAt: null,
          errorMessage: null,
          metadata,
        }),
      );

      snapchatOptions = {
        postPlatformId: postPlatform.id,
        postType: metadata.postType,
        profileId: metadata.profileId,
      };
    }

    if (xPost && xSocialAccountId) {
      const metadata: XPlatformMetadata = {
        provider: 'x',
      };

      const postPlatform = await this.postPlatformRepository.save(
        this.postPlatformRepository.create({
          postId: post.id,
          socialAccountId: xSocialAccountId,
          socialPageId: null,
          platformStatus: PlatformPostStatus.PENDING,
          platformPostId: null,
          publishedAt: null,
          errorMessage: null,
          metadata,
        }),
      );

      xOptions = {
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
          tiktok: tiktokOptions,
          snapchat: snapchatOptions,
          x: xOptions,
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
        tiktokPost,
        snapchatPost,
        xPost,
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
        tiktokPost,
        snapchatPost,
        xPost,
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
      tiktokPost,
      snapchatPost,
      xPost,
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

  async analyticsForUser(
    userId: string,
    options: { range?: PostsAnalyticsRange; timezone?: string } = {},
  ) {
    const range = options.range ?? PostsAnalyticsRange.DAYS_30;
    const timezone = this.resolveTimezone(options.timezone);
    const days = this.resolveAnalyticsRangeDays(range);
    const now = new Date();
    const periodStart = this.shiftDays(now, -days);
    const previousPeriodStart = this.shiftDays(periodStart, -days);

    const [periodPosts, previousPeriodTotal, scheduledPosts] = await Promise.all([
      this.postsRepository.find({
        where: {
          userId,
          createdAt: MoreThanOrEqual(periodStart),
        },
        relations: { platforms: true },
        order: { createdAt: 'ASC' },
      }),
      this.postsRepository.count({
        where: {
          userId,
          createdAt: And(
            MoreThanOrEqual(previousPeriodStart),
            LessThan(periodStart),
          ),
        },
      }),
      this.postsRepository.find({
        where: {
          userId,
          status: PostStatus.SCHEDULED,
          scheduledAt: MoreThanOrEqual(now),
        },
        select: { id: true, scheduledAt: true },
        order: { scheduledAt: 'ASC' },
      }),
    ]);

    const totalPosts = periodPosts.length;
    const published = periodPosts.filter(
      (post) => post.status === PostStatus.PUBLISHED,
    ).length;
    const failed = periodPosts.filter(
      (post) => post.status === PostStatus.FAILED,
    ).length;
    const scheduled = scheduledPosts.length;
    const totalPostsChangePercent =
      previousPeriodTotal > 0
        ? Math.round(
            ((totalPosts - previousPeriodTotal) / previousPeriodTotal) * 100,
          )
        : totalPosts > 0
          ? 100
          : 0;
    const publishedPercent =
      totalPosts > 0 ? Math.round((published / totalPosts) * 100) : 0;
    const nextScheduledAt = scheduledPosts[0]?.scheduledAt ?? null;

    return {
      range,
      timezone,
      summary: {
        totalPosts,
        totalPostsChangePercent,
        published,
        publishedPercent,
        scheduled,
        nextScheduledIn: this.formatNextScheduledIn(nextScheduledAt, now),
        nextScheduledAt,
        failed,
      },
      publishingTrend: this.buildPublishingTrend(periodPosts, {
        range,
        periodStart,
        now,
        timezone,
      }),
      platformDistribution: this.buildPlatformDistribution(periodPosts),
      postingFrequency: this.buildPostingFrequency(periodPosts, timezone),
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
      tiktokPost: publishOptions.tiktok !== null,
      snapchatPost: publishOptions.snapchat !== null,
      xPost: publishOptions.x !== null,
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
      select: { id: true, scheduledAt: true },
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
        const tiktokResults: Record<string, unknown>[] = [];
        const snapchatResults: Record<string, unknown>[] = [];
        const xResults: Record<string, unknown>[] = [];

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
          } else if (meta.provider === 'tiktok') {
            tiktokResults.push(
              await this.publishTikTokPost(post.userId, post, {
                postPlatformId: platform.id,
              }),
            );
          } else if (meta.provider === 'snapchat') {
            snapchatResults.push(
              await this.publishSnapchatPost(post.userId, post, {
                postPlatformId: platform.id,
                postType: meta.postType,
                profileId: meta.profileId ?? null,
              }),
            );
          } else if (meta.provider === 'x') {
            xResults.push(
              await this.publishXPost(post.userId, post, {
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
            tiktok: tiktokResults[0] ?? null,
            tiktokResults,
            snapchat: snapchatResults[0] ?? null,
            snapchatResults,
            x: xResults[0] ?? null,
            xResults,
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
      tiktok: TikTokPublishOptions | null;
      snapchat: SnapchatPublishOptions | null;
      x: XPublishOptions | null;
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
      let tiktokResult: Record<string, unknown> | null = null;
      let snapchatResult: Record<string, unknown> | null = null;
      let xResult: Record<string, unknown> | null = null;

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
      if (options.tiktok) {
        tiktokResult = await this.publishTikTokPost(
          userId,
          post,
          options.tiktok,
        );
      }
      if (options.snapchat) {
        snapchatResult = await this.publishSnapchatPost(
          userId,
          post,
          options.snapchat,
        );
      }
      if (options.x) {
        xResult = await this.publishXPost(userId, post, options.x);
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
          tiktok: tiktokResult,
          snapchat: snapchatResult,
          x: xResult,
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

  private async publishTikTokPost(
    userId: string,
    post: Post,
    options: TikTokPublishOptions,
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

    const title = (post.title?.trim() || post.caption?.trim() || '').trim();
    const description = (post.caption?.trim() || post.title?.trim() || '').trim();
    const imageUrls = (post.media ?? [])
      .filter((item) => item.type !== PostMediaType.VIDEO)
      .sort((a, b) => a.order - b.order)
      .map((item) => item.url);
    const videoUrl = (post.media ?? []).find(
      (item) => item.type === PostMediaType.VIDEO,
    )?.url;

    if (!videoUrl && !imageUrls.length) {
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage =
        'TikTok post requires at least one image or video';
      await this.postPlatformRepository.save(postPlatform);
      return {
        status: PlatformPostStatus.FAILED,
        error: postPlatform.errorMessage,
      };
    }

    try {
      const created = await this.tiktokService.createPostForUser(userId, {
        title: title || null,
        description: description || null,
        videoUrl: videoUrl ?? null,
        imageUrls: videoUrl ? undefined : imageUrls,
      });

      postPlatform.platformStatus = PlatformPostStatus.PUBLISHED;
      postPlatform.platformPostId =
        created.postIds[0] ?? created.publishId ?? null;
      postPlatform.publishedAt = new Date();
      postPlatform.errorMessage = null;
      await this.postPlatformRepository.save(postPlatform);

      return {
        status: PlatformPostStatus.PUBLISHED,
        platformPostId: postPlatform.platformPostId,
        publishId: created.publishId,
        publishStatus: created.status,
        postIds: created.postIds,
      };
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `TikTok publish failed postId=${post.id}: ${messageText}`,
      );
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage = messageText;
      await this.postPlatformRepository.save(postPlatform);
      return { status: PlatformPostStatus.FAILED, error: messageText };
    }
  }

  private async publishSnapchatPost(
    userId: string,
    post: Post,
    options: SnapchatPublishOptions,
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

    const sortedMedia = [...(post.media ?? [])].sort(
      (a, b) => a.order - b.order,
    );
    const video = sortedMedia.find((item) => item.type === PostMediaType.VIDEO);
    const image = sortedMedia.find((item) => item.type !== PostMediaType.VIDEO);

    let mediaUrl: string | undefined;
    let mediaType: 'IMAGE' | 'VIDEO' | undefined;

    if (options.postType === 'SPOTLIGHT') {
      mediaUrl = video?.url;
      mediaType = 'VIDEO';
    } else if (video?.url) {
      mediaUrl = video.url;
      mediaType = 'VIDEO';
    } else if (image?.url) {
      mediaUrl = image.url;
      mediaType = 'IMAGE';
    }

    if (!mediaUrl || !mediaType) {
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage =
        options.postType === 'SPOTLIGHT'
          ? 'Snapchat Spotlight requires a video'
          : 'Snapchat post requires at least one image or video';
      await this.postPlatformRepository.save(postPlatform);
      return {
        status: PlatformPostStatus.FAILED,
        error: postPlatform.errorMessage,
      };
    }

    try {
      const created = await this.snapchatService.createPostForUser(userId, {
        postType: options.postType,
        profileId: options.profileId,
        title: post.title?.trim() || null,
        description: post.caption?.trim() || null,
        mediaUrl,
        mediaType,
      });

      postPlatform.platformStatus = PlatformPostStatus.PUBLISHED;
      postPlatform.platformPostId =
        (typeof created.postId === 'string' && created.postId) ||
        created.mediaId ||
        null;
      postPlatform.publishedAt = new Date();
      postPlatform.errorMessage = null;
      await this.postPlatformRepository.save(postPlatform);

      return {
        status: PlatformPostStatus.PUBLISHED,
        platformPostId: postPlatform.platformPostId,
        kind: created.kind,
        profileId: created.profileId,
        mediaId: created.mediaId,
        spotlightId:
          'spotlightId' in created ? (created.spotlightId ?? null) : null,
        savedStoryId:
          'savedStoryId' in created ? (created.savedStoryId ?? null) : null,
      };
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Snapchat publish failed postId=${post.id}: ${messageText}`,
      );
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage = messageText;
      await this.postPlatformRepository.save(postPlatform);
      return { status: PlatformPostStatus.FAILED, error: messageText };
    }
  }

  private async publishXPost(
    userId: string,
    post: Post,
    options: XPublishOptions,
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

    if (!text && !imageUrls.length && !videoUrl) {
      postPlatform.platformStatus = PlatformPostStatus.FAILED;
      postPlatform.errorMessage =
        'X post requires text, an image, or a video';
      await this.postPlatformRepository.save(postPlatform);
      return {
        status: PlatformPostStatus.FAILED,
        error: postPlatform.errorMessage,
      };
    }

    try {
      const created = await this.xService.createPostForUser(userId, {
        text: text || null,
        imageUrls: videoUrl ? undefined : imageUrls.slice(0, 4),
        videoUrl: videoUrl ?? null,
      });

      postPlatform.platformStatus = PlatformPostStatus.PUBLISHED;
      postPlatform.platformPostId = created.postId;
      postPlatform.publishedAt = new Date();
      postPlatform.errorMessage = null;
      await this.postPlatformRepository.save(postPlatform);

      return {
        status: PlatformPostStatus.PUBLISHED,
        platformPostId: postPlatform.platformPostId,
        mediaIds: created.mediaIds,
      };
    } catch (error) {
      const messageText =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `X publish failed postId=${post.id}: ${messageText}`,
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
    tiktok: TikTokPublishOptions | null;
    snapchat: SnapchatPublishOptions | null;
    x: XPublishOptions | null;
  } {
    let google: GooglePublishOptions | null = null;
    let pinterest: PinterestPublishOptions | null = null;
    let facebook: FacebookPublishOptions | null = null;
    let instagram: InstagramPublishOptions | null = null;
    let linkedin: LinkedInPublishOptions | null = null;
    let linkedinOrganization: LinkedInOrganizationPublishOptions | null = null;
    let thread: ThreadPublishOptions | null = null;
    let tiktok: TikTokPublishOptions | null = null;
    let snapchat: SnapchatPublishOptions | null = null;
    let x: XPublishOptions | null = null;

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
      } else if (meta.provider === 'tiktok') {
        tiktok = {
          postPlatformId: platform.id,
        };
      } else if (meta.provider === 'snapchat') {
        snapchat = {
          postPlatformId: platform.id,
          postType: meta.postType,
          profileId: meta.profileId ?? null,
        };
      } else if (meta.provider === 'x') {
        x = {
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
      tiktok,
      snapchat,
      x,
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

  private resolveTimezone(timezone?: string): string {
    const value = timezone?.trim() || 'UTC';
    try {
      Intl.DateTimeFormat(undefined, { timeZone: value });
      return value;
    } catch {
      return 'UTC';
    }
  }

  private resolveAnalyticsRangeDays(range: PostsAnalyticsRange): number {
    switch (range) {
      case PostsAnalyticsRange.DAYS_7:
        return 7;
      case PostsAnalyticsRange.DAYS_90:
        return 90;
      case PostsAnalyticsRange.DAYS_30:
      default:
        return 30;
    }
  }

  private shiftDays(date: Date, days: number): Date {
    const shifted = new Date(date);
    shifted.setDate(shifted.getDate() + days);
    return shifted;
  }

  private formatNextScheduledIn(
    scheduledAt: Date | null,
    now: Date,
  ): string | null {
    if (!scheduledAt) {
      return null;
    }

    const diffMs = scheduledAt.getTime() - now.getTime();
    if (diffMs <= 0) {
      return null;
    }

    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (diffHours >= 24) {
      return `${Math.floor(diffHours / 24)}d`;
    }
    if (diffHours > 0) {
      return `${diffHours}h`;
    }
    return `${Math.max(diffMinutes, 1)}m`;
  }

  private buildPublishingTrend(
    posts: Post[],
    options: {
      range: PostsAnalyticsRange;
      periodStart: Date;
      now: Date;
      timezone: string;
    },
  ) {
    const bucketCount =
      options.range === PostsAnalyticsRange.DAYS_7 ? 7 : 5;
    const rangeMs = options.now.getTime() - options.periodStart.getTime();
    const bucketMs = rangeMs / bucketCount;

    return Array.from({ length: bucketCount }, (_, index) => {
      const start = new Date(options.periodStart.getTime() + bucketMs * index);
      const end =
        index === bucketCount - 1
          ? options.now
          : new Date(options.periodStart.getTime() + bucketMs * (index + 1));

      let published = 0;
      let failed = 0;

      for (const post of posts) {
        if (post.status === PostStatus.PUBLISHED) {
          const at = post.publishedAt ?? post.createdAt;
          if (at >= start && at < end) {
            published += 1;
          }
        } else if (post.status === PostStatus.FAILED) {
          const at = post.updatedAt ?? post.createdAt;
          if (at >= start && at < end) {
            failed += 1;
          }
        }
      }

      return {
        date: this.formatTrendLabel(start, options.range, options.timezone),
        published,
        failed,
        total: published + failed,
      };
    });
  }

  private buildPlatformDistribution(posts: Post[]) {
    const counts = new Map<string, number>();

    for (const post of posts) {
      for (const platform of post.platforms ?? []) {
        const meta = platform.metadata as PlatformMetadata | null;
        const provider = meta?.provider;
        if (!provider) {
          continue;
        }

        const slug =
          provider === 'linkedin_organization' ? 'linkedin' : provider;
        counts.set(slug, (counts.get(slug) ?? 0) + 1);
      }
    }

    const total = Array.from(counts.values()).reduce((sum, count) => sum + count, 0);

    return Array.from(counts.entries())
      .map(([slug, count]) => ({
        platform: this.getPlatformLabel(slug),
        slug,
        count,
        percent: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  private buildPostingFrequency(posts: Post[], timezone: string) {
    const dayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const counts = new Map(dayOrder.map((day) => [day, 0]));

    for (const post of posts) {
      if (post.status !== PostStatus.PUBLISHED) {
        continue;
      }

      const date = post.publishedAt ?? post.createdAt;
      const day = this.getWeekdayLabel(date, timezone);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }

    return dayOrder.map((day) => ({
      day,
      count: counts.get(day) ?? 0,
    }));
  }

  private formatTrendLabel(
    date: Date,
    range: PostsAnalyticsRange,
    timezone: string,
  ): string {
    const options: Intl.DateTimeFormatOptions =
      range === PostsAnalyticsRange.DAYS_7
        ? { weekday: 'short', timeZone: timezone }
        : { month: 'short', day: 'numeric', timeZone: timezone };

    return new Intl.DateTimeFormat('en-US', options).format(date);
  }

  private getWeekdayLabel(date: Date, timezone: string): string {
    const label = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      timeZone: timezone,
    }).format(date);

    return label.slice(0, 3);
  }

  private getPlatformLabel(slug: string): string {
    const labels: Record<string, string> = {
      google: 'Google',
      pinterest: 'Pinterest',
      facebook: 'Facebook',
      instagram: 'Instagram',
      linkedin: 'LinkedIn',
      thread: 'Threads',
      tiktok: 'TikTok',
      snapchat: 'Snapchat',
      x: 'X',
    };

    return labels[slug] ?? slug;
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
