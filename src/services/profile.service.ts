import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { plainToInstance } from 'class-transformer';
import { ChangePasswordDto } from '../auth/dto/change-password.dto';
import { UpdateProfileDto } from '../auth/dto/update-profile.dto';
import { UserResponseDto } from '../auth/dto/user-response.dto';
import { User } from '../entities/user.entity';
import { UsersService } from './users.service';

@Injectable()
export class ProfileService {
  constructor(private readonly usersService: UsersService) {}

  async getProfile(userId: string) {
    const user = await this.usersService.findByIdOrFail(userId);
    return this.toUserResponse(user);
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.usersService.findByIdOrFail(userId);

    const updates: Partial<User> = {};
    if (dto.name !== undefined) updates.name = dto.name.trim();
    if (dto.timezone !== undefined) updates.timezone = dto.timezone.trim();
    if (dto.phone !== undefined) updates.phone = dto.phone.trim() || null;
    if (dto.avatar !== undefined) updates.avatar = dto.avatar.trim() || null;
    if (dto.deviceId !== undefined) updates.deviceId = dto.deviceId.trim() || null;
    if (dto.fcmToken !== undefined) updates.fcmToken = dto.fcmToken.trim() || null;
    if (dto.appVersion !== undefined) {
      updates.appVersion = dto.appVersion.trim() || null;
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException('No profile fields provided to update');
    }

    const updated = await this.usersService.updateProfile(user.id, updates);

    return {
      message: 'Profile updated successfully',
      user: this.toUserResponse(updated),
    };
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.usersService.findByIdOrFail(userId);

    const isCurrentValid = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );
    if (!isCurrentValid) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(
        'New password must be different from the current password',
      );
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.usersService.updatePassword(user.id, hashedPassword);

    return {
      message: 'Password changed successfully',
    };
  }

  private toUserResponse(user: User): UserResponseDto {
    return plainToInstance(UserResponseDto, user, {
      excludeExtraneousValues: true,
    });
  }
}
