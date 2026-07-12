import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Activity } from './activity.entity';

export enum AdminRole {
  SUPER_ADMIN = 'superAdmin',
  ADMIN = 'admin',
}

export enum AdminStatus {
  ACTIVE = 'active',
  DEACTIVE = 'deactive',
}

@Entity('admins')
export class Admin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({
    type: 'enum',
    enum: AdminRole,
    default: AdminRole.ADMIN,
  })
  role: AdminRole;

  @Column({
    type: 'enum',
    enum: AdminStatus,
    default: AdminStatus.ACTIVE,
  })
  status: AdminStatus;

  @Column({ type: 'varchar', nullable: true })
  avatar?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt?: Date | null;

  @OneToMany(() => Activity, (activity) => activity.admin)
  activities: Activity[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
