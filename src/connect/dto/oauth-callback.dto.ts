/**
 * OAuth providers append arbitrary extra query params (Google: scope, authuser,
 * prompt; Meta: error_reason, error_code; ...). This is an interface rather
 * than a class-validator DTO so the global ValidationPipe (forbidNonWhitelisted)
 * does not reject legitimate provider callbacks.
 */
export interface OAuthCallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
  [key: string]: string | undefined;
}
