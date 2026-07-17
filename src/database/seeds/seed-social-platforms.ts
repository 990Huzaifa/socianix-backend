import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { buildDatabaseOptions } from '../../config/database.config';
import { SocialPlatform } from '../../entities/social-platform.entity';
import { SOCIAL_PLATFORM_SEEDS } from './social-platforms.data';

loadEnv();

async function seedSocialPlatforms(): Promise<void> {
  const dataSource = new DataSource(buildDatabaseOptions());
  await dataSource.initialize();

  const repository = dataSource.getRepository(SocialPlatform);

  let created = 0;
  let updated = 0;

  try {
    for (const seed of SOCIAL_PLATFORM_SEEDS) {
      const existing = await repository.findOne({ where: { slug: seed.slug } });

      if (existing) {
        await repository.update(existing.id, seed);
        updated += 1;
        console.log(`Updated platform: ${seed.slug}`);
      } else {
        await repository.save(repository.create(seed));
        created += 1;
        console.log(`Created platform: ${seed.slug}`);
      }
    }

    console.log(
      `\nSocial platforms seed complete. Created: ${created}, Updated: ${updated}.`,
    );
  } finally {
    await dataSource.destroy();
  }
}

seedSocialPlatforms()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Social platforms seed failed:', error);
    process.exit(1);
  });
