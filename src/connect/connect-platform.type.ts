export const CONNECT_PLATFORMS = [
  'google',
  'meta',
  'thread',
  'x',
  'linkedin',
  'pinterest',
  'tiktok',
] as const;

export type ConnectPlatform = (typeof CONNECT_PLATFORMS)[number];

export function isConnectPlatform(value: string): value is ConnectPlatform {
  return (CONNECT_PLATFORMS as readonly string[]).includes(value);
}
