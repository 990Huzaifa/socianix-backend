import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWalletSys1784877333767 implements MigrationInterface {
    name = 'AddWalletSys1784877333767'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "user_auth_providers" DROP CONSTRAINT "FK_user_auth_providers_userId"`);
        await queryRunner.query(`ALTER TABLE "user_auth_providers" DROP CONSTRAINT "UQ_user_auth_providers_provider_providerUserId"`);
        await queryRunner.query(`CREATE TABLE "wallets" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "credits" integer NOT NULL DEFAULT '0', "freeCredits" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "userId" uuid, CONSTRAINT "REL_2ecdb33f23e9a6fc392025c0b9" UNIQUE ("userId"), CONSTRAINT "PK_8402e5df5a30a229380e83e4f7e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "users" ADD "walletId" uuid`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_0a95e6aab86ff1b0278c18cf48e" UNIQUE ("walletId")`);
        await queryRunner.query(`ALTER TABLE "social_platforms" ADD "creditCost" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "user_auth_providers" ADD CONSTRAINT "UQ_9a2b64c1c8cb8cb3876debf7c8c" UNIQUE ("provider", "providerUserId")`);
        await queryRunner.query(`ALTER TABLE "user_auth_providers" ADD CONSTRAINT "FK_344bc2c598846ecf8f58274fdaa" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "wallets" ADD CONSTRAINT "FK_2ecdb33f23e9a6fc392025c0b97" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "FK_0a95e6aab86ff1b0278c18cf48e" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "FK_0a95e6aab86ff1b0278c18cf48e"`);
        await queryRunner.query(`ALTER TABLE "wallets" DROP CONSTRAINT "FK_2ecdb33f23e9a6fc392025c0b97"`);
        await queryRunner.query(`ALTER TABLE "user_auth_providers" DROP CONSTRAINT "FK_344bc2c598846ecf8f58274fdaa"`);
        await queryRunner.query(`ALTER TABLE "user_auth_providers" DROP CONSTRAINT "UQ_9a2b64c1c8cb8cb3876debf7c8c"`);
        await queryRunner.query(`ALTER TABLE "social_platforms" DROP COLUMN "creditCost"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "UQ_0a95e6aab86ff1b0278c18cf48e"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "walletId"`);
        await queryRunner.query(`DROP TABLE "wallets"`);
        await queryRunner.query(`ALTER TABLE "user_auth_providers" ADD CONSTRAINT "UQ_user_auth_providers_provider_providerUserId" UNIQUE ("provider", "providerUserId")`);
        await queryRunner.query(`ALTER TABLE "user_auth_providers" ADD CONSTRAINT "FK_user_auth_providers_userId" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

}
