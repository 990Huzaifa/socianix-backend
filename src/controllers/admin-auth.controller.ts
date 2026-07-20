import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentAdmin } from '../admin/decorators/current-admin.decorator';
import { AdminLoginDto } from '../admin/dto/admin-login.dto';
import { AdminJwtAuthGuard } from '../admin/guards/admin-jwt-auth.guard';
import { Admin } from '../entities/admin.entity';
import { AdminAuthService } from '../services/admin-auth.service';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: AdminLoginDto) {
    return this.adminAuthService.login(dto);
  }

  @Get('me')
  @UseGuards(AdminJwtAuthGuard)
  me(@CurrentAdmin() admin: Admin) {
    return this.adminAuthService.getProfile(admin.id);
  }
}
