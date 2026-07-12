import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SocialAccount } from './social-account.entity';

export enum SocialPlatformStatus {
  ACTIVE = 'active',
  DEACTIVE = 'deactive',
  COMING_SOON = 'comingSoon',
}

@Entity('social_platforms')
export class SocialPlatform {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ unique: true })
  slug: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', nullable: true })
  icon?: string | null;

  @Column({ type: 'varchar', nullable: true })
  logo?: string | null;

  @Column({
    type: 'enum',
    enum: SocialPlatformStatus,
    default: SocialPlatformStatus.ACTIVE,
  })
  status: SocialPlatformStatus;

  @OneToMany(() => SocialAccount, (account) => account.platform)
  accounts: SocialAccount[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
