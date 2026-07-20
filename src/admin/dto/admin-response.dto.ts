import { Exclude, Expose } from 'class-transformer';
import { AdminRole, AdminStatus } from '../../entities/admin.entity';

@Exclude()
export class AdminResponseDto {
  @Expose()
  id: string;

  @Expose()
  name: string;

  @Expose()
  email: string;

  @Expose()
  role: AdminRole;

  @Expose()
  status: AdminStatus;

  @Expose()
  avatar?: string | null;

  @Expose()
  lastLoginAt?: Date | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
