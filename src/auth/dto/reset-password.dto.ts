import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(4, 8)
  otp: string;

  @IsString()
  @MinLength(6)
  newPassword: string;
}
