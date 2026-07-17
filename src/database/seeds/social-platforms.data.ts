import { SocialPlatformStatus } from '../../entities/social-platform.entity';

export type SocialPlatformSeed = {
  name: string;
  slug: string;
  description: string;
  icon: string | null;
  logo: string | null;
  status: SocialPlatformStatus;
};

export const SOCIAL_PLATFORM_SEEDS: SocialPlatformSeed[] = [
  {
    name: 'Google',
    slug: 'google',
    description: 'Connect your Google account.',
    icon: null,
    logo: null,
    status: SocialPlatformStatus.ACTIVE,
  },
  {
    name: 'Pinterest',
    slug: 'pinterest',
    description: 'Connect your Pinterest account to manage boards and pins.',
    icon: null,
    logo: null,
    status: SocialPlatformStatus.ACTIVE,
  },
  {
    name: 'Meta',
    slug: 'meta',
    description: 'Connect Facebook and Instagram via Meta.',
    icon: null,
    logo: null,
    status: SocialPlatformStatus.COMING_SOON,
  },
  {
    name: 'LinkedIn',
    slug: 'linkedin',
    description: 'Connect your LinkedIn account.',
    icon: null,
    logo: null,
    status: SocialPlatformStatus.COMING_SOON,
  },
  {
    name: 'TikTok',
    slug: 'tiktok',
    description: 'Connect your TikTok account.',
    icon: null,
    logo: null,
    status: SocialPlatformStatus.COMING_SOON,
  },
];
