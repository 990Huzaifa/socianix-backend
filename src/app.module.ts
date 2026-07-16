import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtStrategy } from './auth/strategies/jwt.strategy';
import { buildDatabaseOptions } from './config/database.config';
import {
  AppController,
  AuthController,
  ContactController,
} from './controllers';
import { Lead } from './entities/lead.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { User } from './entities/user.entity';
import {
  AppService,
  AuthService,
  ContactService,
  MailService,
  PasswordResetTokenService,
  UsersService,
} from './services';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    HttpModule,
    TypeOrmModule.forRootAsync({
      useFactory: () => ({
        ...buildDatabaseOptions(),
        autoLoadEntities: true,
      }),
    }),
    TypeOrmModule.forFeature([User, PasswordResetToken, Lead]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: parseInt(configService.get<string>('JWT_EXPIRES_IN') ?? '7d'),
        },
      }),
    }),
  ],
  controllers: [AppController, AuthController, ContactController],
  providers: [
    AppService,
    AuthService,
    UsersService,
    MailService,
    ContactService,
    PasswordResetTokenService,
    JwtStrategy,
  ],
})
export class AppModule {}
