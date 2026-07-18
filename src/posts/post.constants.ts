export const PUSHER_EVENTS = {
  POST_PROCESSED: 'post.processed',
} as const;

export function userPrivateChannel(userId: string): string {
  return `private-user-${userId}`;
}
