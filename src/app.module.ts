import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtStrategy } from './auth/strategies/jwt.strategy';
import { buildDatabaseOptions } from './config/database.config';
import {
  AppController,
  AuthController,
  ConnectController,
  ContactController,
  GoogleController,
  MetaController,
  PinterestController,
  PostsController,
  PusherController,
  XController,
} from './controllers';
import { Lead } from './entities/lead.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Post } from './entities/post.entity';
import { PostMedia } from './entities/post-media.entity';
import { SocialAccount } from './entities/social-account.entity';
import { SocialPlatform } from './entities/social-platform.entity';
import { User } from './entities/user.entity';
import { POSTS_QUEUE } from './posts/post.constants';
import {
  AppService,
  AuthService,
  ConnectService,
  ContactService,
  MailService,
  PasswordResetTokenService,
  PlatformOAuthService,
  GoogleService,
  MetaService,
  PinterestService,
  PostsService,
  PusherService,
  S3Service,
  SocialAccountsService,
  ThreadsService,
  UsersService,
  XService,
} from './services';
import { PostsProcessor } from './services/posts.processor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    HttpModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST') ?? '127.0.0.1',
          port: Number(configService.get<string>('REDIS_PORT') ?? 6379),
          password: configService.get<string>('REDIS_PASSWORD') || undefined,
          maxRetriesPerRequest: null,
        },
      }),
    }),
    BullModule.registerQueue({ name: POSTS_QUEUE }),
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildDatabaseOptions(),
        autoLoadEntities: true,
      }),
    }),
    TypeOrmModule.forFeature([
      User,
      PasswordResetToken,
      Lead,
      SocialPlatform,
      SocialAccount,
      Post,
      PostMedia,
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const expiresIn = configService.get<string>('JWT_EXPIRES_IN') ?? '7d';
        return {
          secret: configService.getOrThrow<string>('JWT_SECRET'),
          signOptions: {
            expiresIn: /^\d+$/.test(expiresIn)
              ? Number(expiresIn)
              : (expiresIn as `${number}d` | `${number}h` | `${number}m` | `${number}s`),
          },
        };
      },
    }),
  ],
  controllers: [
    AppController,
    AuthController,
    ConnectController,
    ContactController,
    GoogleController,
    MetaController,
    PinterestController,
    PostsController,
    PusherController,
    XController,
  ],
  providers: [
    AppService,
    AuthService,
    UsersService,
    MailService,
    ConnectService,
    ContactService,
    PlatformOAuthService,
    GoogleService,
    MetaService,
    PinterestService,
    ThreadsService,
    XService,
    SocialAccountsService,
    PasswordResetTokenService,
    S3Service,
    PusherService,
    PostsService,
    PostsProcessor,
    JwtStrategy,
  ],
})
export class AppModule {}
