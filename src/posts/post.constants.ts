export const POSTS_QUEUE = 'posts';

export const POST_JOBS = {
  PROCESS_CREATE: 'process-create',
} as const;

export const PUSHER_EVENTS = {
  POST_PROCESSED: 'post.processed',
} as const;

export function userPrivateChannel(userId: string): string {
  return `private-user-${userId}`;
}
