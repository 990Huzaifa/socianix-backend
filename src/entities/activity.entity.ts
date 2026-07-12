import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Admin } from './admin.entity';
import { User } from './user.entity';

export enum ActivityActorType {
  ADMIN = 'admin',
  USER = 'user',
  SYSTEM = 'system',
}

@Entity('activities')
export class Activity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: ActivityActorType,
  })
  actorType: ActivityActorType;

  @Column({ type: 'uuid', nullable: true })
  adminId?: string | null;

  @ManyToOne(() => Admin, (admin) => admin.activities, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'adminId' })
  admin?: Admin | null;

  @Column({ type: 'uuid', nullable: true })
  userId?: string | null;

  @ManyToOne(() => User, (user) => user.activities, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'userId' })
  user?: User | null;

  @Column()
  action: string;

  @Column({ type: 'varchar', nullable: true })
  entityType?: string | null;

  @Column({ type: 'uuid', nullable: true })
  entityId?: string | null;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  ip?: string | null;

  @Column({ type: 'varchar', nullable: true })
  userAgent?: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
