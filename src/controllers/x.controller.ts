import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../entities/user.entity';
import { XService } from '../services/x.service';

@Controller('x')
@UseGuards(JwtAuthGuard)
export class XController {
  constructor(private readonly xService: XService) {}

  @Get('me')
  getProfile(@CurrentUser() user: User) {
    return this.xService.getProfileForUser(user.id);
  }
}
