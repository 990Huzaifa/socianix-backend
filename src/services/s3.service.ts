import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
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
    const bucket = this.getBucketName();
    const region = this.getRegion();
    return `https://${bucket}.s3.${region}.amazonaws.com/${key.replace(/^\/+/, '')}`;
  }

  buildObjectKey(folder: 'image' | 'video', originalName: string): string {
    const safeExt = extname(originalName || '')
      .toLowerCase()
      .replace(/[^a-z0-9.]/g, '');
    const base = `${randomUUID()}${safeExt || ''}`;
    return `${folder}/${base}`;
  }

  async uploadFile(input: S3UploadInput): Promise<S3UploadResult> {
    if (!this.isEnabled()) {
      throw new BadRequestException('S3 is not configured');
    }

    const key = this.buildObjectKey(input.folder, input.originalName);
    const bucket = this.getBucketName();

    await this.getClient().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: input.buffer,
        ContentType: input.mimeType,
      }),
    );

    const url = this.getPublicUrl(key);
    this.logger.log(`Uploaded to S3 key=${key}`);

    return {
      key,
      url,
      bucket,
      contentType: input.mimeType,
    };
  }
}
