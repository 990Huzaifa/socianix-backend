import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminListQueryDto } from '../admin/dto/list-query.dto';
import { AdminJwtAuthGuard } from '../admin/guards/admin-jwt-auth.guard';
import { AdminLeadsService } from '../services/admin-leads.service';

@Controller('admin/leads')
@UseGuards(AdminJwtAuthGuard)
export class AdminLeadsController {
  constructor(private readonly adminLeadsService: AdminLeadsService) {}

  @Get()
  list(@Query() query: AdminListQueryDto) {
    return this.adminLeadsService.findAll({
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    });
  }

  @Get(':id')
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminLeadsService.findOne(id);
  }
}
