import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../entities/user.entity';
import { CreatePostDto } from '../posts/dto/create-post.dto';
import { ListPostsQueryDto } from '../posts/dto/list-posts-query.dto';
import { PostsService } from '../services/posts.service';

@Controller('posts')
@UseGuards(JwtAuthGuard)
export class PostsController {
  constructor(private readonly postsService: PostsService) {}

  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: memoryStorage(),
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB per file
      },
      fileFilter: (_req, file, callback) => {
        if (
          file.mimetype.startsWith('image/') ||
          file.mimetype.startsWith('video/')
        ) {
          callback(null, true);
          return;
        }
        callback(new Error('Only image and video files are allowed'), false);
      },
    }),
  )
  create(
    @CurrentUser() user: User,
    @Body() dto: CreatePostDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.postsService.create(user.id, dto, files ?? []);
  }

  @Get()
  findAll(@CurrentUser() user: User, @Query() query: ListPostsQueryDto) {
    return this.postsService.findAllForUser(user.id, {
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.postsService.findOneForUser(user.id, id);
  }
}
