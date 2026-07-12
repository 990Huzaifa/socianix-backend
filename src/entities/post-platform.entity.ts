import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Post } from './post.entity';
import { SocialAccount } from './social-account.entity';
import { SocialPage } from './social-page.entity';

export enum PlatformPostStatus {
  PENDING = 'Pending',
  PUBLISHING = 'Publishing',
  PUBLISHED = 'Published',
  FAILED = 'Failed',
}

@Entity('post_platforms')
export class PostPlatform {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  postId: string;

  @ManyToOne(() => Post, (post) => post.platforms, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'postId' })
  post: Post;

  @Column()
  socialAccountId: string;

  @ManyToOne(() => SocialAccount, (account) => account.postPlatforms, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'socialAccountId' })
  socialAccount: SocialAccount;

  @Column({ type: 'uuid', nullable: true })
  socialPageId?: string | null;

  @ManyToOne(() => SocialPage, (page) => page.postPlatforms, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'socialPageId' })
  socialPage?: SocialPage | null;

  @Column({
    type: 'enum',
    enum: PlatformPostStatus,
    default: PlatformPostStatus.PENDING,
  })
  platformStatus: PlatformPostStatus;

  @Column({ type: 'varchar', nullable: true })
  platformPostId?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
