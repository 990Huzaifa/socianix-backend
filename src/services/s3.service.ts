import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { extname } from 'path';

export type S3UploadInput = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  /** Folder prefix without trailing slash, e.g. `image` or `video` */
  folder: 'image' | 'video';
};

export type S3UploadResult = {
  key: string;
  url: string;
  bucket: string;
  contentType: string;
};

@Injectable()
export class S3Service implements OnModuleInit {
  private readonly logger = new Logger(S3Service.name);
  private client: S3Client | null = null;
  private bucketName: string | null = null;
  private region: string | null = null;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'AWS_SECRET_ACCESS_KEY',
    );
    const region =
      this.configService.get<string>('AWS_S3_REGION') ??
      this.configService.get<string>('AWS_REGION') ??
      'eu-north-1';
    const bucketName = this.configService.get<string>('AWS_S3_BUCKET_NAME');

    if (!accessKeyId || !secretAccessKey || !bucketName) {
      this.logger.warn(
        'S3 is not fully configured (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_S3_BUCKET_NAME). Uploads will be unavailable.',
      );
      return;
    }

    this.region = region;
    this.bucketName = bucketName;
    this.client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    this.logger.log(
      `S3 client connected (region=${region}, bucket=${bucketName})`,
    );
  }

  isEnabled(): boolean {
    return this.client != null && this.bucketName != null;
  }

  getClient(): S3Client {
    if (!this.client) {
      throw new BadRequestException('S3 client is not configured');
    }
    return this.client;
  }

  getBucketName(): string {
    if (!this.bucketName) {
      throw new BadRequestException('S3 bucket is not configured');
    }
    return this.bucketName;
  }

  getRegion(): string {
    if (!this.region) {
      throw new BadRequestException('S3 region is not configured');
    }
    return this.region;
  }

  getPublicUrl(key: string): string {
    const normalizedKey = key.replace(/^\/+/, '');
    const cdnBase =
      this.configService.get<string>('AWS_S3_CDN_URL') ??
      this.configService.get<string>('MEDIA_CDN_URL') ??
      'https://media.socialsyncc.com';

    return `${cdnBase.replace(/\/$/, '')}/${normalizedKey}`;
  }

  extractKeyFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      const key = parsed.pathname.replace(/^\/+/, '');
      if (!key) {
        return null;
      }

      const cdnHost = (
        this.configService.get<string>('AWS_S3_CDN_URL') ??
        this.configService.get<string>('MEDIA_CDN_URL') ??
        'https://media.socialsyncc.com'
      )
        .replace(/^https?:\/\//, '')
        .replace(/\/$/, '');

      if (this.bucketName && this.region) {
        const s3Host = `${this.bucketName}.s3.${this.region}.amazonaws.com`;
        if (parsed.hostname === s3Host || parsed.hostname === cdnHost) {
          return key;
        }
      }

      if (parsed.hostname === cdnHost) {
        return key;
      }

      return null;
    } catch {
      return null;
    }
  }

  async deleteByUrl(url: string): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    const key = this.extractKeyFromUrl(url);
    if (!key) {
      return false;
    }

    await this.getClient().send(
      new DeleteObjectCommand({
        Bucket: this.getBucketName(),
        Key: key,
      }),
    );

    this.logger.log(`Deleted from S3 key=${key}`);
    return true;
  }

  buildObjectKey(folder: 'image' | 'video', originalName: string): string {
    const safeExt = extname(originalName || '')
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '');
    const base = `${randomUUID()}${safeExt || ''}`;
    return `${folder}/${base}`;
  }

  /**
   * Resolve a reliable Content-Type for S3.
   * Mobile clients sometimes send empty or application/octet-stream mimetypes.
   */
  resolveContentType(input: {
    mimeType?: string | null;
    originalName?: string | null;
    folder: 'image' | 'video';
  }): string {
    const mime = (input.mimeType ?? '').trim().toLowerCase();
    if (
      (mime.startsWith('image/') || mime.startsWith('video/')) &&
      mime !== 'application/octet-stream'
    ) {
      return mime;
    }

    const ext = extname(input.originalName || '')
      .toLowerCase()
      .replace(/^\./, '');

    const byExt: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      heic: 'image/heic',
      heif: 'image/heif',
      bmp: 'image/bmp',
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      m4v: 'video/x-m4v',
      webm: 'video/webm',
      avi: 'video/x-msvideo',
      mkv: 'video/x-matroska',
      mpeg: 'video/mpeg',
      mpg: 'video/mpeg',
    };

    if (ext && byExt[ext]) {
      return byExt[ext];
    }

    return input.folder === 'video' ? 'video/mp4' : 'image/jpeg';
  }

  async uploadFile(input: S3UploadInput): Promise<S3UploadResult> {
    if (!this.isEnabled()) {
      throw new BadRequestException('S3 is not configured');
    }

    const key = this.buildObjectKey(input.folder, input.originalName);
    const bucket = this.getBucketName();
    const contentType = this.resolveContentType({
      mimeType: input.mimeType,
      originalName: input.originalName,
      folder: input.folder,
    });

    await this.getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: input.buffer,
        ContentType: contentType,
        Metadata: {
          'original-name': (input.originalName || 'upload').slice(0, 200),
        },
      }),
    );

    const url = this.getPublicUrl(key);
    this.logger.log(`Uploaded to S3 key=${key} contentType=${contentType}`);

    return {
      key,
      url,
      bucket,
      contentType,
    };
  }
}
