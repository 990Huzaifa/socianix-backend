import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsEnum, IsOptional } from 'class-validator';
import { AdminListQueryDto } from '../admin/dto/list-query.dto';
import { CreatePlatformDto } from '../admin/dto/create-platform.dto';
import { UpdatePlatformDto } from '../admin/dto/update-platform.dto';
import { UpdatePlatformStatusDto } from '../admin/dto/update-platform-status.dto';
import { AdminJwtAuthGuard } from '../admin/guards/admin-jwt-auth.guard';
import { SocialPlatformStatus } from '../entities/social-platform.entity';
import { AdminPlatformsService } from '../services/admin-platforms.service';

class AdminPlatformsListQueryDto extends AdminListQueryDto {
  @IsOptional()
  @IsEnum(SocialPlatformStatus)
  status?: SocialPlatformStatus;
}

@Controller('admin/platforms')
@UseGuards(AdminJwtAuthGuard)
export class AdminPlatformsController {
  constructor(private readonly adminPlatformsService: AdminPlatformsService) {}

  @Get()
  list(@Query() query: AdminPlatformsListQueryDto) {
    return this.adminPlatformsService.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
      status: query.status,
    });
  }

  /** Create / add a platform */
  @Post()
  async create(@Body() dto: CreatePlatformDto) {
    const platform = await this.adminPlatformsService.create(dto);
    return {
      message: 'Platform created successfully',
      platform,
    };
  }

  @Get(':id')
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminPlatformsService.findOne(id);
  }

  /** Edit / update a platform (partial) */
  @Patch(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformDto,
  ) {
    const platform = await this.adminPlatformsService.update(id, dto);
    return {
      message: 'Platform updated successfully',
      platform,
    };
  }

  /** Edit / update a platform (same fields as PATCH) */
  @Put(':id')
  async replace(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformDto,
  ) {
    const platform = await this.adminPlatformsService.update(id, dto);
    return {
      message: 'Platform updated successfully',
      platform,
    };
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformStatusDto,
  ) {
    const platform = await this.adminPlatformsService.updateStatus(
      id,
      dto.status,
    );
    return {
      message: 'Platform status updated successfully',
      platform,
    };
  }
}
