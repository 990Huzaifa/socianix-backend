import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { plainToInstance } from 'class-transformer';
import { AdminLoginDto } from '../admin/dto/admin-login.dto';
import { AdminResponseDto } from '../admin/dto/admin-response.dto';
import { AdminJwtPayload } from '../admin/types/admin-jwt-payload.type';
import { Admin, AdminStatus } from '../entities/admin.entity';
import { AdminsService } from './admins.service';

@Injectable()
export class AdminAuthService {
  constructor(
    private readonly adminsService: AdminsService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: AdminLoginDto) {
    const admin = await this.adminsService.findByEmail(dto.email);
    if (!admin) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, admin.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (admin.status !== AdminStatus.ACTIVE) {
      throw new UnauthorizedException('Admin account is deactivated');
    }

    await this.adminsService.touchLastLogin(admin.id);
    const refreshed = await this.adminsService.findByIdOrFail(admin.id);

    return this.buildAuthResponse(refreshed);
  }

  async getProfile(adminId: string) {
    const admin = await this.adminsService.findByIdOrFail(adminId);
    return this.toAdminResponse(admin);
  }

  private buildAuthResponse(admin: Admin) {
    const payload: AdminJwtPayload = {
      sub: admin.id,
      email: admin.email,
      type: 'admin',
      role: admin.role,
    };

    return {
      accessToken: this.jwtService.sign(payload),
      admin: this.toAdminResponse(admin),
    };
  }

  private toAdminResponse(admin: Admin): AdminResponseDto {
    return plainToInstance(AdminResponseDto, admin, {
      excludeExtraneousValues: true,
    });
  }
}
