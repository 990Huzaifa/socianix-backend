import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminListQueryDto } from '../admin/dto/list-query.dto';
import { CreatePlatformDto } from '../admin/dto/create-platform.dto';
import { UpdatePlatformDto } from '../admin/dto/update-platform.dto';
import { UpdatePlatformStatusDto } from '../admin/dto/update-platform-status.dto';
import { AdminJwtAuthGuard } from '../admin/guards/admin-jwt-auth.guard';
import { AdminPlatformsService } from '../services/admin-platforms.service';

@Controller('admin/platforms')
@UseGuards(AdminJwtAuthGuard)
export class AdminPlatformsController {
  constructor(private readonly adminPlatformsService: AdminPlatformsService) {}

  @Get()
  list(@Query() query: AdminListQueryDto) {
    return this.adminPlatformsService.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  }

  @Post()
  create(@Body() dto: CreatePlatformDto) {
    return this.adminPlatformsService.create(dto);
  }

  @Get(':id')
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminPlatformsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformDto,
  ) {
    return this.adminPlatformsService.update(id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformStatusDto,
  ) {
    return this.adminPlatformsService.updateStatus(id, dto.status);
  }
}
