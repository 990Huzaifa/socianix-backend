import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDatabaseOptions } from '../../config/database.config';
import { User } from '../../entities/user.entity';
import { Wallet } from '../../entities/wallet.entity';
import { INITIAL_FREE_CREDITS } from '../../services/wallet.service';

loadEnv();

/**
 * Create wallets for users who do not have one yet (10 free credits each).
 */
export async function seedWallets(dataSource: DataSource): Promise<void> {
  const usersRepository = dataSource.getRepository(User);
  const walletsRepository = dataSource.getRepository(Wallet);

  const usersWithoutWallet = await usersRepository
    .createQueryBuilder('user')
    .leftJoin(Wallet, 'wallet', 'wallet.userId = user.id')
    .where('wallet.id IS NULL')
    .select(['user.id', 'user.email'])
    .getMany();

  let created = 0;

  for (const user of usersWithoutWallet) {
    const wallet = await walletsRepository.save(
      walletsRepository.create({
        user: { id: user.id } as User,
        credits: 0,
        freeCredits: INITIAL_FREE_CREDITS,
      }),
    );

    await usersRepository
      .createQueryBuilder()
      .relation(User, 'wallet')
      .of(user.id)
      .set(wallet);

    created += 1;
    console.log(
      `Created wallet for user ${user.email} (freeCredits=${INITIAL_FREE_CREDITS})`,
    );
  }

  console.log(
    `\nWallets seed complete. Created: ${created}, Already had wallet: skipped.`,
  );
}

async function run(): Promise<void> {
  const dataSource = new DataSource(buildDatabaseOptions());
  await dataSource.initialize();

  try {
    await seedWallets(dataSource);
  } finally {
    await dataSource.destroy();
  }
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Wallets seed failed:', error);
      process.exit(1);
    });
}
