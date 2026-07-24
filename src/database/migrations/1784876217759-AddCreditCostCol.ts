import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCreditCostCol1784876217759 implements MigrationInterface {
    name = 'AddCreditCostCol1784876217759'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."user_auth_providers_provider_enum" AS ENUM('google', 'apple')`);
        await queryRunner.query(`CREATE TABLE "user_auth_providers" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "provider" "public"."user_auth_providers_provider_enum" NOT NULL, "providerUserId" character varying NOT NULL, "providerEmail" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_9a2b64c1c8cb8cb3876debf7c8c" UNIQUE ("provider", "providerUserId"), CONSTRAINT "PK_e3b60f30b8112ac5bb474a2fe4b" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "social_platforms" ADD "creditCost" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password" DROP NOT NULL`);
        await queryRunner.query(`ALTER TABLE "user_auth_providers" ADD CONSTRAINT "FK_344bc2c598846ecf8f58274fdaa" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_auth_providers" DROP CONSTRAINT "FK_344bc2c598846ecf8f58274fdaa"`);
        await queryRunner.query(`ALTER TABLE "users" ALTER COLUMN "password" SET NOT NULL`);
        await queryRunner.query(`ALTER TABLE "social_platforms" DROP COLUMN "creditCost"`);
        await queryRunner.query(`DROP TABLE "user_auth_providers"`);
        await queryRunner.query(`DROP TYPE "public"."user_auth_providers_provider_enum"`);
    }

}
