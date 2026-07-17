import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../entities/user.entity';
import { PinterestService } from '../services/pinterest.service';

@Controller('pinterest')
@UseGuards(JwtAuthGuard)
export class PinterestController {
  constructor(private readonly pinterestService: PinterestService) {}

  @Get('boards')
  getBoards(
    @CurrentUser() user: User,
    @Query('page_size') pageSize?: string,
    @Query('bookmark') bookmark?: string,
  ) {
    return this.pinterestService.getBoardsForUser(user.id, {
      pageSize: pageSize ? Number(pageSize) : undefined,
      bookmark,
    });
  }

  @Get('boards/:boardId')
  getBoard(@CurrentUser() user: User, @Param('boardId') boardId: string) {
    return this.pinterestService.getBoardForUser(user.id, boardId);
  }
}
