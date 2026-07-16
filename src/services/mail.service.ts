import * as fs from 'fs';
import * as path from 'path';
import * as Handlebars from 'handlebars';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import FormData from 'form-data';

export type MailFrom = 'noreply' | 'support' | 'info';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private readonly mailDir = this.resolveMailDir();
    private readonly templatesDir = path.join(this.mailDir, 'templates');
    private readonly assetsDir = path.join(this.mailDir, 'assets');
    private cachedLogoSrc: string | null | undefined;

    constructor(
        private readonly httpService: HttpService,
        private readonly configService: ConfigService,
    ) { }

    async sendEmailVerification(
        toEmail: string,
        name: string,
        otp: string,
    ): Promise<void> {
        const html = this.renderTemplate('verify-email', {
            name,
            otp,
            logoSrc: this.logoSrc(),
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
            logoSrc: this.logoSrc(),
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
            logoSrc: this.logoSrc(),
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
            logoSrc: this.logoSrc(),
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
            logoSrc: this.logoSrc(),
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
        const url = this.configService.get<string>('MAIL_SERVICE_URL');
        const apiKey = this.configService.get<string>('MAIL_API_KEY');
        const masterUser = this.configService.get<string>(
            'MAIL_SERVICE_MASTER_USER',
        );
        const fromEmail = this.resolveFromEmail(from);

        if (!url || !apiKey || !masterUser) {
            this.logger.log(
                `[mail:dev] from=${fromEmail} to=${toEmail} subject="${subject}"`,
            );
            return;
        }

        const formData = new FormData();
        formData.append('master_user', masterUser);
        formData.append('from_email', fromEmail);
        formData.append('to_email', toEmail);
        formData.append('subject', subject);
        formData.append('body_html', bodyHtml);

        await firstValueFrom(
            this.httpService.post(url, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'x-api-key': apiKey,
                },
            }),
        );
    }

    private resolveFromEmail(from: MailFrom): string {
        const envKey = {
            noreply: 'MAIL_FROM_NOREPLY',
            support: 'MAIL_FROM_SUPPORT',
            info: 'MAIL_FROM_INFO',
        }[from];

        return this.configService.getOrThrow<string>(envKey);
    }

    private renderTemplate(
        templateName: string,
        data: Record<string, unknown>,
    ): string {
        const filePath = path.join(this.templatesDir, `${templateName}.hbs`);
        const source = fs.readFileSync(filePath, 'utf8');
        return Handlebars.compile(source)(data);
    }

    private logoSrc(): string | null {
        if (this.cachedLogoSrc !== undefined) {
            return this.cachedLogoSrc;
        }

        const candidates = ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.webp', 'logo.svg'];

        for (const filename of candidates) {
            const filePath = path.join(this.assetsDir, filename);
            if (!fs.existsSync(filePath)) {
                continue;
            }

            const buffer = fs.readFileSync(filePath);
            const mime = this.mimeType(filename);
            this.cachedLogoSrc = `data:${mime};base64,${buffer.toString('base64')}`;
            return this.cachedLogoSrc;
        }

        this.logger.warn(
            `No logo found in ${this.assetsDir} (expected logo.png)`,
        );
        this.cachedLogoSrc = null;
        return null;
    }

    private mimeType(filename: string): string {
        const ext = path.extname(filename).toLowerCase();
        switch (ext) {
            case '.jpg':
            case '.jpeg':
                return 'image/jpeg';
            case '.webp':
                return 'image/webp';
            case '.svg':
                return 'image/svg+xml';
            default:
                return 'image/png';
        }
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
}
