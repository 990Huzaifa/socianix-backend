import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

export enum PasswordResetTokenType {
  FORGOT_PASSWORD = 'forgotPassword',
  EMAIL_VERIFICATION = 'emailVerification',
}

@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @ManyToOne(() => User, (user) => user.passwordResetTokens, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column()
  codeHash: string;

  @Column({
    type: 'enum',
    enum: PasswordResetTokenType,
    default: PasswordResetTokenType.FORGOT_PASSWORD,
  })
  type: PasswordResetTokenType;

  @Column({ type: 'timestamptz' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  usedAt?: Date | null;

  @CreateDateColumn()
  createdAt: Date;
}
