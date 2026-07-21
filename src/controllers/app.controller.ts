import { Controller, Get, Header } from '@nestjs/common';
import { AppService } from '../services/app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('tiktokcZVVriPlLtaFAnqPFRc13Tx77DyZBbqQ.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  getTikTokVerification(): string {
    return this.appService.getTikTokVerification();
  }
}
