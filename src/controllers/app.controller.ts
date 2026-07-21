import { Controller, Get, Header } from '@nestjs/common';
import { AppService } from '../services/app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('tiktokbO452fXf4wN4vpD4CZ9Hpu2cNRZRidXx.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  getTikTokDomainVerification(): string {
    return this.appService.getTikTokDomainVerification();
  }
}
