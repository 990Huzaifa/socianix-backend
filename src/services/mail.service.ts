import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';
import { join } from 'path';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

type TemplateName =
  | 'email-verification'
  | 'welcome'
  | 'forgot-password';

type TemplateVars = Record<string, string | number>;

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private readonly templatesDir = join(__dirname, '..', 'mail', 'templates');

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const host = this.configService.get<string>('MAIL_HOST');
    if (!host) {
      this.logger.warn(
        'MAIL_HOST is not set — emails will be logged instead of sent',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: Number(this.configService.get('MAIL_PORT') ?? 587),
      secure: this.configService.get('MAIL_SECURE') === 'true',
      auth: {
        user: this.configService.getOrThrow<string>('MAIL_USER'),
        pass: this.configService.getOrThrow<string>('MAIL_PASSWORD'),
      },
    });

    try {
      await this.transporter.verify();
      this.logger.log('Mail transporter ready');
    } catch (error) {
      this.logger.error('Mail transporter verification failed', error);
    }
  }

  async sendEmailVerification(
    email: string,
    name: string,
    otp: string,
  ): Promise<void> {
    const expiresInMinutes = this.getOtpExpiryMinutes();
    const html = await this.renderTemplate('email-verification', {
      name,
      otp,
      expiresInMinutes,
      ...this.commonVars(),
    });

    await this.sendMail({
      to: email,
      subject: `Verify your ${this.appName()} email`,
      html,
      text: `Hi ${name}, your ${this.appName()} verification code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
    });
  }

  async sendWelcome(email: string, name: string): Promise<void> {
    const html = await this.renderTemplate('welcome', {
      name,
      ...this.commonVars(),
    });

    await this.sendMail({
      to: email,
      subject: `Welcome to ${this.appName()}`,
      html,
      text: `Hi ${name}, welcome to ${this.appName()}! Your account is ready.`,
    });
  }

  async sendPasswordResetOtp(
    email: string,
    name: string,
    otp: string,
  ): Promise<void> {
    const expiresInMinutes = this.getOtpExpiryMinutes();
    const html = await this.renderTemplate('forgot-password', {
      name,
      otp,
      expiresInMinutes,
      ...this.commonVars(),
    });

    await this.sendMail({
      to: email,
      subject: `Reset your ${this.appName()} password`,
      html,
      text: `Hi ${name}, your ${this.appName()} password reset code is ${otp}. It expires in ${expiresInMinutes} minutes.`,
    });
  }

  private async sendMail(options: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `[mail:dev] to=${options.to} subject="${options.subject}" text=${options.text}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.configService.getOrThrow<string>('MAIL_FROM'),
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });
  }

  private async renderTemplate(
    name: TemplateName,
    vars: TemplateVars,
  ): Promise<string> {
    const filePath = join(this.templatesDir, `${name}.html`);
    let html = await readFile(filePath, 'utf8');

    for (const [key, value] of Object.entries(vars)) {
      html = html.replaceAll(`{{${key}}}`, String(value));
    }

    return html;
  }

  private commonVars(): TemplateVars {
    return {
      appName: this.appName(),
      appUrl: this.configService.get<string>('APP_URL') ?? 'http://localhost:3000',
      year: new Date().getFullYear(),
    };
  }

  private appName(): string {
    return this.configService.get<string>('APP_NAME') ?? 'Socianix';
  }

  private getOtpExpiryMinutes(): number {
    return Number(this.configService.get('OTP_EXPIRES_IN_MINUTES') ?? 10);
  }
}
