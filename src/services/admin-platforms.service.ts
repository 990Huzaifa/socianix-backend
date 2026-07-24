import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { CreatePlatformDto } from '../admin/dto/create-platform.dto';
import { UpdatePlatformDto } from '../admin/dto/update-platform.dto';
import {
  SocialPlatform,
  SocialPlatformStatus,
} from '../entities/social-platform.entity';

@Injectable()
export class AdminPlatformsService {
  constructor(
    @InjectRepository(SocialPlatform)
    private readonly platformsRepository: Repository<SocialPlatform>,
  ) {}

  async findAll(
    options: {
      page?: number;
      limit?: number;
      status?: SocialPlatformStatus;
    } = {},
  ) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const skip = (page - 1) * limit;

    const [items, total] = await this.platformsRepository.findAndCount({
      where: options.status ? { status: options.status } : undefined,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  async findOne(id: string): Promise<SocialPlatform> {
    const platform = await this.platformsRepository.findOne({ where: { id } });
    if (!platform) {
      throw new NotFoundException('Platform not found');
    }
    return platform;
  }

  async create(dto: CreatePlatformDto): Promise<SocialPlatform> {
    const slug = dto.slug.toLowerCase();
    const existing = await this.platformsRepository.findOne({
      where: { slug },
    });
    if (existing) {
      throw new ConflictException('Platform slug already exists');
    }

    const platform = this.platformsRepository.create({
      name: dto.name,
      slug,
      description: dto.description ?? null,
      icon: dto.icon ?? null,
      logo: dto.logo ?? null,
      status: dto.status ?? SocialPlatformStatus.ACTIVE,
      creditCost: dto.creditCost ?? 0,
    });

    return this.platformsRepository.save(platform);
  }

  async update(id: string, dto: UpdatePlatformDto): Promise<SocialPlatform> {
    const platform = await this.findOne(id);

    if (dto.slug !== undefined) {
      const slug = dto.slug.toLowerCase();
      const existing = await this.platformsRepository.findOne({
        where: { slug, id: Not(id) },
      });
      if (existing) {
        throw new ConflictException('Platform slug already exists');
      }
      platform.slug = slug;
    }

    if (dto.name !== undefined) platform.name = dto.name;
    if (dto.description !== undefined) platform.description = dto.description;
    if (dto.icon !== undefined) platform.icon = dto.icon;
    if (dto.logo !== undefined) platform.logo = dto.logo;
    if (dto.status !== undefined) platform.status = dto.status;
    if (dto.creditCost !== undefined) platform.creditCost = dto.creditCost;

    return this.platformsRepository.save(platform);
  }

  async updateStatus(
    id: string,
    status: SocialPlatformStatus,
  ): Promise<SocialPlatform> {
    const platform = await this.findOne(id);
    platform.status = status;
    return this.platformsRepository.save(platform);
  }
}
