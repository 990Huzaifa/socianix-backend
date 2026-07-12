import { DataSourceOptions } from 'typeorm';

export const buildDatabaseOptions = (): DataSourceOptions => ({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'root',
  database: process.env.DB_DATABASE ?? 'socianix',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  synchronize: false,
  logging: process.env.DB_LOGGING === 'true',
  entities: [__dirname + '/../entities/**/*.{ts,js}'],
  migrations: [__dirname + '/../database/migrations/*.{ts,js}'],
});
