import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../entities/user.entity';
import { MetaService } from '../services/meta.service';

@Controller('meta')
@UseGuards(JwtAuthGuard)
export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  @Get('facebook-pages')
  facebookPageList(@CurrentUser() user: User) {
    return this.metaService.facebookPageList(user.id);
  }
}
