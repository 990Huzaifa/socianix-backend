import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtStrategy } from './auth/strategies/jwt.strategy';
import { buildDatabaseOptions } from './config/database.config';
import {
  AppController,
  AuthController,
  ConnectController,
  ContactController,
  GoogleController,
  LinkedInController,
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
import { PostPlatform } from './entities/post-platform.entity';
import { SocialAccount } from './entities/social-account.entity';
import { SocialPlatform } from './entities/social-platform.entity';
import { User } from './entities/user.entity';
import {
  AppService,
  AuthService,
  ConnectService,
  ContactService,
  MailService,
  PasswordResetTokenService,
  PlatformOAuthService,
  GoogleService,
  LinkedInService,
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
import { PostsSchedulerService } from './services/posts.scheduler';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    HttpModule,
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
      PostPlatform,
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
    LinkedInController,
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
    LinkedInService,
    MetaService,
    PinterestService,
    ThreadsService,
    XService,    SocialAccountsService,
    PasswordResetTokenService,
    S3Service,
    PusherService,
    PostsService,
    PostsSchedulerService,
    JwtStrategy,
  ],
})
export class AppModule {}
