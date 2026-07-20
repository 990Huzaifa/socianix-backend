import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Admin, AdminStatus } from '../../entities/admin.entity';
import { AdminsService } from '../../services/admins.service';
import { AdminJwtPayload } from '../types/admin-jwt-payload.type';

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    configService: ConfigService,
    private readonly adminsService: AdminsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: AdminJwtPayload): Promise<Admin> {
    if (payload.type !== 'admin') {
      throw new UnauthorizedException('Invalid admin token');
    }

    const admin = await this.adminsService.findById(payload.sub);
    if (!admin) {
      throw new UnauthorizedException('Invalid token');
    }

    if (admin.status !== AdminStatus.ACTIVE) {
      throw new UnauthorizedException('Admin account is deactivated');
    }

    return admin;
  }
}
