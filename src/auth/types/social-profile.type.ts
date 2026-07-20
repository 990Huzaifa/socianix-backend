export type SocialProfile = {
  providerUserId: string;
  email?: string | null;
  name?: string | null;
  avatar?: string | null;
};

export type SocialLoginProfile = SocialProfile & {
  email: string;
  name: string;
};
