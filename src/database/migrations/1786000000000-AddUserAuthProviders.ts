import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAuthProviders1786000000000 implements MigrationInterface {
  name = 'AddUserAuthProviders1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."user_auth_providers_provider_enum" AS ENUM('google', 'apple')`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_auth_providers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "provider" "public"."user_auth_providers_provider_enum" NOT NULL,
        "providerUserId" character varying NOT NULL,
        "providerEmail" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_auth_providers_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_user_auth_providers_provider_providerUserId" UNIQUE ("provider", "providerUserId")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_auth_providers" ADD CONSTRAINT "FK_user_auth_providers_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_auth_providers" DROP CONSTRAINT "FK_user_auth_providers_userId"`,
    );
    await queryRunner.query(`DROP TABLE "user_auth_providers"`);
    await queryRunner.query(
      `DROP TYPE "public"."user_auth_providers_provider_enum"`,
    );
  }
}
