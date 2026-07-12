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
import { PostMedia } from './post-media.entity';
import { PostPlatform } from './post-platform.entity';

export enum PostStatus {
  DRAFT = 'Draft',
  SCHEDULED = 'Scheduled',
  PUBLISHING = 'Publishing',
  PUBLISHED = 'Published',
  FAILED = 'Failed',
}

@Entity('posts')
export class Post {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.posts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', nullable: true })
  title?: string | null;

  @Column({ type: 'text', nullable: true })
  caption?: string | null;

  @Column({
    type: 'enum',
    enum: PostStatus,
    default: PostStatus.DRAFT,
  })
  status: PostStatus;

  @Column({ type: 'timestamptz', nullable: true })
  scheduledAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  publishedAt?: Date | null;

  @OneToMany(() => PostMedia, (media) => media.post)
  media: PostMedia[];

  @OneToMany(() => PostPlatform, (platform) => platform.post)
  platforms: PostPlatform[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
