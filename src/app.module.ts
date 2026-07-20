import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminJwtStrategy } from './admin/strategies/admin-jwt.strategy';
import { JwtStrategy } from './auth/strategies/jwt.strategy';
import { buildDatabaseOptions } from './config/database.config';
import {
  AdminAuthController,
  AdminLeadsController,
  AdminPlatformsController,
  AppController,
  AuthController,
  ConnectController,
  ContactController,
  GoogleController,
  LinkedInController,
  MetaController,
  PinterestController,
  PlatformsController,
  PostsController,
  ProfileController,
  PusherController,
  SocialAccountsController,
  XController,
} from './controllers';
import { Admin } from './entities/admin.entity';
import { Lead } from './entities/lead.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Post } from './entities/post.entity';
import { PostMedia } from './entities/post-media.entity';
import { PostPlatform } from './entities/post-platform.entity';
import { SocialAccount } from './entities/social-account.entity';
import { SocialPlatform } from './entities/social-platform.entity';
import { User } from './entities/user.entity';
import { UserAuthProvider } from './entities/user-auth-provider.entity';
import {
  AdminAuthService,
  AdminLeadsService,
  AdminPlatformsService,
  AdminsService,
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
  ProfileService,
  PusherService,
  S3Service,
  SocialAccountsService,
  SocialTokenVerifierService,
  ThreadsService,
  UserAuthProviderService,
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
      UserAuthProvider,
      PasswordResetToken,
      Admin,
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
    AdminAuthController,
    AdminPlatformsController,
    AdminLeadsController,
    ConnectController,
    ContactController,
    GoogleController,
    LinkedInController,
    MetaController,
    PinterestController,
    PlatformsController,
    PostsController,
    ProfileController,
    PusherController,
    SocialAccountsController,
    XController,
  ],
  providers: [
    AppService,
    AuthService,
    AdminAuthService,
    AdminsService,
    AdminPlatformsService,
    AdminLeadsService,
    UsersService,
    UserAuthProviderService,
    SocialTokenVerifierService,
    MailService,
    ConnectService,
    ContactService,
    PlatformOAuthService,
    GoogleService,
    LinkedInService,
    MetaService,
    PinterestService,
    ThreadsService,
    XService,
    SocialAccountsService,
    PasswordResetTokenService,
    S3Service,
    PusherService,
    PostsService,
    ProfileService,
    PostsSchedulerService,
    JwtStrategy,
    AdminJwtStrategy,
  ],
})
export class AppModule {}
