import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    // Replace with a real email provider later (SMTP, SES, etc.).
    this.logger.log(`Password reset OTP for ${email}: ${otp}`);
  }
}
