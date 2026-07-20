import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum SocialAuthProvider {
  GOOGLE = 'google',
  APPLE = 'apple',
}

@Entity('user_auth_providers')
@Unique(['provider', 'providerUserId'])
export class UserAuthProvider {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.authProviders, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({
    type: 'enum',
    enum: SocialAuthProvider,
  })
  provider: SocialAuthProvider;

  @Column()
  providerUserId: string;

  @Column({ type: 'varchar', nullable: true })
  providerEmail?: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
