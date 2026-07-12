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
import { SocialAccount } from './social-account.entity';
import { PostPlatform } from './post-platform.entity';

@Entity('social_pages')
export class SocialPage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  socialAccountId: string;

  @ManyToOne(() => SocialAccount, (account) => account.pages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'socialAccountId' })
  socialAccount: SocialAccount;

  @Column()
  platformPageId: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  username?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @Column({ type: 'boolean', default: false })
  selected: boolean;

  @OneToMany(() => PostPlatform, (postPlatform) => postPlatform.socialPage)
  postPlatforms: PostPlatform[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
