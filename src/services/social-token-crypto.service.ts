import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

@Injectable()
export class SocialTokenCryptoService {
  private static readonly ALGORITHM = 'aes-256-gcm';
  private static readonly IV_LENGTH = 12;
  private static readonly VERSION_PREFIX = 'enc:v1';

  constructor(private readonly configService: ConfigService) {}

  encrypt(value: string): string {
    if (!value) {
      return value;
    }

    if (this.isEncrypted(value)) {
      return value;
    }

    const iv = randomBytes(SocialTokenCryptoService.IV_LENGTH);
    const cipher = createCipheriv(
      SocialTokenCryptoService.ALGORITHM,
      this.getKey(),
      iv,
    );
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      SocialTokenCryptoService.VERSION_PREFIX,
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(':');
  }

  decrypt(value: string | null | undefined): string | null | undefined {
    if (value == null || value === '') {
      return value;
    }

    if (!this.isEncrypted(value)) {
      // Backward-compatible fallback for rows stored before encryption.
      return value;
    }

    const [, version, ivBase64, authTagBase64, payloadBase64] =
      value.split(':');

    if (
      version !== 'v1' ||
      !ivBase64 ||
      !authTagBase64 ||
      !payloadBase64
    ) {
      throw new InternalServerErrorException(
        'Stored social token format is invalid',
      );
    }

    try {
      const decipher = createDecipheriv(
        SocialTokenCryptoService.ALGORITHM,
        this.getKey(),
        Buffer.from(ivBase64, 'base64'),
      );
      decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'));

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(payloadBase64, 'base64')),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch {
      throw new InternalServerErrorException(
        'Failed to decrypt stored social token',
      );
    }
  }

  private isEncrypted(value: string): boolean {
    return value.startsWith(`${SocialTokenCryptoService.VERSION_PREFIX}:`);
  }

  private getKey(): Buffer {
    const secret = this.configService.get<string>('SOCIAL_TOKEN_ENCRYPTION_KEY');
    if (!secret) {
      throw new InternalServerErrorException(
        'SOCIAL_TOKEN_ENCRYPTION_KEY is not configured',
      );
    }

    // Accept a passphrase-style env var while deriving a stable 32-byte key.
    return createHash('sha256').update(secret, 'utf8').digest();
  }
}
