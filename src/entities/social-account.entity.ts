import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';
import { SocialPlatform } from './social-platform.entity';
import { SocialPage } from './social-page.entity';
import { PostPlatform } from './post-platform.entity';

export enum SocialAccountStatus {
  ACTIVE = 'active',
  DISCONNECTED = 'disconnected',
  EXPIRED = 'expired',
}

@Entity('social_accounts')
export class SocialAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.socialAccounts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  platformId: string;

  @ManyToOne(() => SocialPlatform, (platform) => platform.accounts, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'platformId' })
  platform: SocialPlatform;

  @Column()
  platformUserId: string;

  @Column()
  username: string;

  @Column({ type: 'varchar', nullable: true })
  displayName?: string | null;

  @Column({ type: 'varchar', nullable: true })
  profileImage?: string | null;

  /** Stored encrypted at the application layer. */
  @Column({ type: 'text' })
  accessToken: string;

  /** Stored encrypted at the application layer. */
  @Column({ type: 'text', nullable: true })
  refreshToken?: string | null;

  @Column({ type: 'varchar', nullable: true })
  tokenType?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  expiresAt?: Date | null;

  @Column({ type: 'jsonb', nullable: true })
  scopes?: string[] | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: SocialAccountStatus,
    default: SocialAccountStatus.ACTIVE,
  })
  status: SocialAccountStatus;

  @Column({ type: 'timestamptz' })
  connectedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt?: Date | null;

  @OneToMany(() => SocialPage, (page) => page.socialAccount)
  pages: SocialPage[];

  @OneToMany(() => PostPlatform, (postPlatform) => postPlatform.socialAccount)
  postPlatforms: PostPlatform[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
