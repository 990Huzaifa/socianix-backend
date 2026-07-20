import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDatabaseOptions } from '../../config/database.config';
import { seedAdmins } from './seed-admins';
import { seedSocialPlatforms } from './seed-social-platforms';

loadEnv();

async function seed(): Promise<void> {
  const dataSource = new DataSource(buildDatabaseOptions());
  await dataSource.initialize();

  try {
    console.log('--- Seeding admins ---');
    await seedAdmins(dataSource);

    console.log('\n--- Seeding social platforms ---');
    await seedSocialPlatforms(dataSource);

    console.log('\nAll seeds complete.');
  } finally {
    await dataSource.destroy();
  }
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
