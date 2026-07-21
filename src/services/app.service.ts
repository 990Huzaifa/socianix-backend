import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  getTikTokDomainVerification(): string {
    return 'tiktok-developers-site-verification=bO452fXf4wN4vpD4CZ9Hpu2cNRZRidXx';
  }
}
