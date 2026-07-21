import { Injectable } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';

@Injectable()
export class AppService {
  private readonly tiktokVerificationFile =
    'tiktokcZVVriPlLtaFAnqPFRc13Tx77DyZBbqQ.txt';

  getHello(): string {
    return 'Hello World!';
  }

  getTikTokVerification(): string {
    const filePath = join(
      __dirname,
      '..',
      'database',
      this.tiktokVerificationFile,
    );

    return readFileSync(filePath, 'utf8').trim();
  }
}
