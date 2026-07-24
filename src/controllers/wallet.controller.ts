import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../entities/user.entity';
import { WalletService } from '../services/wallet.service';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  /** Get the current user's wallet details. */
  @Get()
  async getWallet(@CurrentUser() user: User) {
    const wallet = await this.walletService.getDetailsForUser(user.id);
    return { wallet };
  }
}
