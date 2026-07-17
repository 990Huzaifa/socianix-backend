import type { ConnectPlatform } from '../connect-platform.type';

export type OAuthStatePayload = {
  sub: string;
  platform: ConnectPlatform;
  purpose: 'social-connect';
  nonce: string;
};

export type OAuthTokenResult = {
  accessToken: string;
  refreshToken?: string | null;
  tokenType?: string | null;
  expiresIn?: number | null;
  scope?: string | null;
};

export type OAuthProfileInfo = {
  platformUserId: string;
  username: string;
  displayName?: string | null;
  profileImage?: string | null;
  email?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type ConnectedAccountResponse = {
  id: string;
  platform: ConnectPlatform;
  platformUserId: string;
  username: string;
  displayName: string | null;
  profileImage: string | null;
  status: string;
  connectedAt: Date;
};
