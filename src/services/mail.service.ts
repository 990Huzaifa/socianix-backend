import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrevoClient } from '@getbrevo/brevo';

export type MailFrom = 'noreply' | 'support' | 'info';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly mailDir = this.resolveMailDir();
  private readonly templatesDir = path.join(this.mailDir, 'templates');
  private readonly assetsDir = path.join(this.mailDir, 'assets');
  private cachedLogoSrc: string | null | undefined;
  private brevoClient: BrevoClient | null = null;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>('MAIL_API_KEY')?.trim();
    if (apiKey) {
      this.brevoClient = new BrevoClient({
        apiKey,
        timeoutInSeconds: 15,
      });
    } else {
      this.logger.warn(
        'MAIL_API_KEY is not set — emails will be logged only (dev mode)',
      );
    }
  }

  async sendEmailVerification(
    toEmail: string,
    name: string,
    otp: string,
  ): Promise<void> {
    const html = this.renderTemplate('verify-email', {
      name,
      otp,
      appName: this.appName(),
      logoUrl: this.logoUrl(),
      year: new Date().getFullYear(),
    });

    await this.sendEmail(
      toEmail,
      `Verify your ${this.appName()} email`,
      html,
      'noreply',
    );
  }

  async sendWelcome(toEmail: string, name: string): Promise<void> {
    const html = this.renderTemplate('welcome-email', {
      name,
      appName: this.appName(),
      logoUrl: this.logoUrl(),
      year: new Date().getFullYear(),
    });

    await this.sendEmail(
      toEmail,
      `Welcome to ${this.appName()}`,
      html,
      'info',
    );
  }

  async sendPasswordResetOtp(
    toEmail: string,
    name: string,
    otp: string,
  ): Promise<void> {
    const html = this.renderTemplate('reset-password-email', {
      name,
      otp,
      appName: this.appName(),
      logoUrl: this.logoUrl(),
      year: new Date().getFullYear(),
    });

    await this.sendEmail(
      toEmail,
      `Reset your ${this.appName()} password`,
      html,
      'support',
    );
  }

  async sendContactReceived(
    toEmail: string,
    name: string,
    inquiry: string,
  ): Promise<void> {
    const html = this.renderTemplate('contact-received', {
      name,
      inquiry,
      appName: this.appName(),
      logoUrl: this.logoUrl(),
      year: new Date().getFullYear(),
    });

    await this.sendEmail(
      toEmail,
      `We received your ${this.appName()} inquiry`,
      html,
      'info',
    );
  }

  async sendContactOwnerNotify(lead: {
    name: string;
    email: string;
    inquiry: string;
    message: string;
  }): Promise<void> {
    const ownerEmail = this.configService.getOrThrow<string>('OWNER_EMAIL');
    const html = this.renderTemplate('contact-owner-notify', {
      name: lead.name,
      email: lead.email,
      inquiry: lead.inquiry,
      message: lead.message,
      appName: this.appName(),
      logoUrl: this.logoUrl(),
      year: new Date().getFullYear(),
    });

    await this.sendEmail(
      ownerEmail,
      `New contact inquiry: ${lead.inquiry}`,
      html,
      'support',
    );
  }

  async sendEmail(
    toEmail: string,
    subject: string,
    bodyHtml: string,
    from: MailFrom = 'noreply',
  ): Promise<void> {
    const fromEmail = this.resolveFromEmail(from);
    const fromName = this.appName();

    if (!this.brevoClient) {
      this.logger.log(
        `[mail:dev] from=${fromEmail} to=${toEmail} subject="${subject}"`,
      );
      return;
    }

    try {
      const result = await this.brevoClient.transactionalEmails.sendTransacEmail(
        {
          sender: { name: fromName, email: fromEmail },
          to: [{ email: toEmail }],
          subject,
          htmlContent: bodyHtml,
        },
      );

      this.logger.log(
        `Brevo email sent to=${toEmail} from=${fromEmail} subject="${subject}" messageId=${(result as { messageId?: string })?.messageId ?? 'n/a'}`,
      );
    } catch (error) {
      this.logger.error(
        `Brevo mail failed to=${toEmail} from=${fromEmail} subject="${subject}" error=${this.formatError(error)}`,
      );
    }
  }

  private resolveFromEmail(from: MailFrom): string {
    const envKey = {
      noreply: 'MAIL_FROM_NOREPLY',
      support: 'MAIL_FROM_SUPPORT',
      info: 'MAIL_FROM_INFO',
    }[from];

    return this.configService.getOrThrow<string>(envKey);
  }

  private logoUrl(): string {
    return 'https://media.socialsyncc.com/logo.png';
  }

  private renderTemplate(
    templateName: string,
    data: Record<string, unknown>,
  ): string {
    const filePath = path.join(this.templatesDir, `${templateName}.hbs`);
    const source = fs.readFileSync(filePath, 'utf8');
    return Handlebars.compile(source)(data);
  }

  private resolveMailDir(): string {
    const fromDist = path.join(__dirname, '..', 'mail');
    if (fs.existsSync(fromDist)) {
      return fromDist;
    }

    return path.join(process.cwd(), 'src', 'mail');
  }

  private appName(): string {
    return this.configService.get<string>('APP_NAME') ?? 'Socianix';
  }

  private formatError(error: unknown): string {
    if (typeof error !== 'object' || error === null) {
      return String(error);
    }

    const err = error as {
      message?: string;
      statusCode?: number;
      body?: unknown;
    };

    return JSON.stringify({
      message: err.message,
      statusCode: err.statusCode,
      body: err.body,
    });
  }
}
