import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../entities/user.entity';
import {
  LinkedInCreatePostDto,
  LinkedInPagePostDto,
} from '../linkedin/dto/linkedin-post.dto';
import { LinkedInService } from '../services/linkedin.service';

@Controller('linkedin')
@UseGuards(JwtAuthGuard)
export class LinkedInController {
  constructor(private readonly linkedInService: LinkedInService) {}

  @Get('me')
  getProfile(@CurrentUser() user: User) {
    return this.linkedInService.getProfileForUser(user.id);
  }

  @Get('organizations')
  getOrganizations(@CurrentUser() user: User) {
    return this.linkedInService.getOrganizationsForUser(user.id);
  }

  @Post('account-post')
  accountPost(@CurrentUser() user: User, @Body() body: LinkedInCreatePostDto) {
    return this.linkedInService.accountPostForUser(user.id, {
      commentary: body.commentary,
      imageUrls: body.imageUrls,
      link: body.link,
      linkTitle: body.linkTitle,
      linkDescription: body.linkDescription,
    });
  }

  @Post('page-post')
  pagePost(@CurrentUser() user: User, @Body() body: LinkedInPagePostDto) {
    return this.linkedInService.pagePostForUser(user.id, body.organizationId, {
      commentary: body.commentary,
      imageUrls: body.imageUrls,
      link: body.link,
      linkTitle: body.linkTitle,
      linkDescription: body.linkDescription,
    });
  }
}
