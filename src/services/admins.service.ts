import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Admin, AdminRole, AdminStatus } from '../entities/admin.entity';

export type CreateAdminData = {
  name: string;
  email: string;
  password: string;
  role?: AdminRole;
  status?: AdminStatus;
  avatar?: string | null;
};

@Injectable()
export class AdminsService {
  constructor(
    @InjectRepository(Admin)
    private readonly adminsRepository: Repository<Admin>,
  ) {}

  async findByEmail(email: string): Promise<Admin | null> {
    return this.adminsRepository.findOne({
      where: { email: email.toLowerCase() },
    });
  }

  async findById(id: string): Promise<Admin | null> {
    return this.adminsRepository.findOne({ where: { id } });
  }

  async findByIdOrFail(id: string): Promise<Admin> {
    const admin = await this.findById(id);
    if (!admin) {
      throw new NotFoundException('Admin not found');
    }
    return admin;
  }

  async create(data: CreateAdminData): Promise<Admin> {
    const admin = this.adminsRepository.create({
      ...data,
      email: data.email.toLowerCase(),
      role: data.role ?? AdminRole.ADMIN,
      status: data.status ?? AdminStatus.ACTIVE,
    });
    return this.adminsRepository.save(admin);
  }

  async touchLastLogin(id: string): Promise<void> {
    await this.adminsRepository.update(id, { lastLoginAt: new Date() });
  }
}
