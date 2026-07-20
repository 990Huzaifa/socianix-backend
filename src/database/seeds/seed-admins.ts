import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { buildDatabaseOptions } from '../../config/database.config';
import {
  Admin,
  AdminRole,
  AdminStatus,
} from '../../entities/admin.entity';

loadEnv();

async function seedAdmins(): Promise<void> {
  const dataSource = new DataSource(buildDatabaseOptions());
  await dataSource.initialize();

  const repository = dataSource.getRepository(Admin);

  const name = 'Super Admin';
  const email = ('admin@socialsyncc.com').toLowerCase();
  const password = 'Admin@9090';
  const role = AdminRole.SUPER_ADMIN;

  try {
    const existing = await repository.findOne({ where: { email } });
    const hashedPassword = await bcrypt.hash(password, 10);

    if (existing) {
      await repository.update(existing.id, {
        name,
        password: hashedPassword,
        role,
        status: AdminStatus.ACTIVE,
      });
      console.log(`Updated admin: ${email} (${role})`);
    } else {
      await repository.save(
        repository.create({
          name,
          email,
          password: hashedPassword,
          role,
          status: AdminStatus.ACTIVE,
        }),
      );
      console.log(`Created admin: ${email} (${role})`);
    }

    console.log('\nAdmin seed complete.');
  } finally {
    await dataSource.destroy();
  }
}

seedAdmins()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Admin seed failed:', error);
    process.exit(1);
  });
