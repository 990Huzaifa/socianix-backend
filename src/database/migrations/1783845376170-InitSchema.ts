import { MigrationInterface, QueryRunner } from "typeorm";

export class InitSchema1783845376170 implements MigrationInterface {
    name = 'InitSchema1783845376170'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."post_media_type_enum" AS ENUM('image', 'video', 'carousel')`);
        await queryRunner.query(`CREATE TABLE "post_media" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "type" "public"."post_media_type_enum" NOT NULL, "url" character varying NOT NULL, "order" integer NOT NULL DEFAULT '0', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_049edb1ce7ab3d2a98009b171d0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "social_pages" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "socialAccountId" uuid NOT NULL, "platformPageId" character varying NOT NULL, "name" character varying NOT NULL, "username" character varying, "metadata" jsonb, "selected" boolean NOT NULL DEFAULT false, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_da74c13cc166d0ef1792b577b51" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."post_platforms_platformstatus_enum" AS ENUM('Pending', 'Publishing', 'Published', 'Failed')`);
        await queryRunner.query(`CREATE TABLE "post_platforms" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "postId" uuid NOT NULL, "socialAccountId" uuid NOT NULL, "socialPageId" uuid, "platformStatus" "public"."post_platforms_platformstatus_enum" NOT NULL DEFAULT 'Pending', "platformPostId" character varying, "publishedAt" TIMESTAMP WITH TIME ZONE, "errorMessage" text, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bfc03009d912109a3a59af52c0" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."posts_status_enum" AS ENUM('Draft', 'Scheduled', 'Publishing', 'Published', 'Failed')`);
        await queryRunner.query(`CREATE TABLE "posts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "title" character varying, "caption" text, "status" "public"."posts_status_enum" NOT NULL DEFAULT 'Draft', "scheduledAt" TIMESTAMP WITH TIME ZONE, "publishedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2829ac61eff60fcec60d7274b9e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."admins_role_enum" AS ENUM('superAdmin', 'admin')`);
        await queryRunner.query(`CREATE TYPE "public"."admins_status_enum" AS ENUM('active', 'deactive')`);
        await queryRunner.query(`CREATE TABLE "admins" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "email" character varying NOT NULL, "password" character varying NOT NULL, "role" "public"."admins_role_enum" NOT NULL DEFAULT 'admin', "status" "public"."admins_status_enum" NOT NULL DEFAULT 'active', "avatar" character varying, "lastLoginAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_051db7d37d478a69a7432df1479" UNIQUE ("email"), CONSTRAINT "PK_e3b38270c97a854c48d2e80874e" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."activities_actortype_enum" AS ENUM('admin', 'user', 'system')`);
        await queryRunner.query(`CREATE TABLE "activities" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "actorType" "public"."activities_actortype_enum" NOT NULL, "adminId" uuid, "userId" uuid, "action" character varying NOT NULL, "entityType" character varying, "entityId" uuid, "description" text, "metadata" jsonb, "ip" character varying, "userAgent" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_7f4004429f731ffb9c88eb486a8" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."password_reset_tokens_type_enum" AS ENUM('forgotPassword')`);
        await queryRunner.query(`CREATE TABLE "password_reset_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "codeHash" character varying NOT NULL, "type" "public"."password_reset_tokens_type_enum" NOT NULL DEFAULT 'forgotPassword', "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "usedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_d16bebd73e844c48bca50ff8d3d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "email" character varying NOT NULL, "password" character varying NOT NULL, "timezone" character varying NOT NULL, "phone" character varying, "avatar" character varying, "deviceId" character varying, "fcmToken" character varying, "ip" character varying, "appVersion" character varying, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."social_platforms_status_enum" AS ENUM('active', 'deactive', 'comingSoon')`);
        await queryRunner.query(`CREATE TABLE "social_platforms" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, "slug" character varying NOT NULL, "description" text, "icon" character varying, "logo" character varying, "status" "public"."social_platforms_status_enum" NOT NULL DEFAULT 'active', "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_7d36f44216dbca3e1f802f40b53" UNIQUE ("slug"), CONSTRAINT "PK_6add75c86f5436b37d36432373a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."social_accounts_status_enum" AS ENUM('active', 'disconnected', 'expired')`);
        await queryRunner.query(`CREATE TABLE "social_accounts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL, "platformId" uuid NOT NULL, "platformUserId" character varying NOT NULL, "username" character varying NOT NULL, "displayName" character varying, "profileImage" character varying, "accessToken" text NOT NULL, "refreshToken" text, "tokenType" character varying, "expiresAt" TIMESTAMP WITH TIME ZONE, "scopes" jsonb, "metadata" jsonb, "status" "public"."social_accounts_status_enum" NOT NULL DEFAULT 'active', "connectedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "lastSyncedAt" TIMESTAMP WITH TIME ZONE, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e9e58d2d8e9fafa20af914d9750" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "post_media" ADD CONSTRAINT "FK_4adcc5190e3b5c7e9001adef3b8" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "social_pages" ADD CONSTRAINT "FK_7bd12fc0fa5142915e9e5e31fb7" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_platforms" ADD CONSTRAINT "FK_3dd4085c4665d0184e061ed91d1" FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_platforms" ADD CONSTRAINT "FK_c21a22220e5524e9c5691f33274" FOREIGN KEY ("socialAccountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "post_platforms" ADD CONSTRAINT "FK_f9290a04376fcdad2885e033b8b" FOREIGN KEY ("socialPageId") REFERENCES "social_pages"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "posts" ADD CONSTRAINT "FK_ae05faaa55c866130abef6e1fee" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "activities" ADD CONSTRAINT "FK_51cceb2b316774ca15a018364ad" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "activities" ADD CONSTRAINT "FK_5a2cfe6f705df945b20c1b22c71" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "FK_d6a19d4b4f6c62dcd29daa497e2" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "social_accounts" ADD CONSTRAINT "FK_7de933c3670ec71c68aca0afd56" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "social_accounts" ADD CONSTRAINT "FK_353f30ec35afad542cca6ee49af" FOREIGN KEY ("platformId") REFERENCES "social_platforms"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "social_accounts" DROP CONSTRAINT "FK_353f30ec35afad542cca6ee49af"`);
        await queryRunner.query(`ALTER TABLE "social_accounts" DROP CONSTRAINT "FK_7de933c3670ec71c68aca0afd56"`);
        await queryRunner.query(`ALTER TABLE "password_reset_tokens" DROP CONSTRAINT "FK_d6a19d4b4f6c62dcd29daa497e2"`);
        await queryRunner.query(`ALTER TABLE "activities" DROP CONSTRAINT "FK_5a2cfe6f705df945b20c1b22c71"`);
        await queryRunner.query(`ALTER TABLE "activities" DROP CONSTRAINT "FK_51cceb2b316774ca15a018364ad"`);
        await queryRunner.query(`ALTER TABLE "posts" DROP CONSTRAINT "FK_ae05faaa55c866130abef6e1fee"`);
        await queryRunner.query(`ALTER TABLE "post_platforms" DROP CONSTRAINT "FK_f9290a04376fcdad2885e033b8b"`);
        await queryRunner.query(`ALTER TABLE "post_platforms" DROP CONSTRAINT "FK_c21a22220e5524e9c5691f33274"`);
        await queryRunner.query(`ALTER TABLE "post_platforms" DROP CONSTRAINT "FK_3dd4085c4665d0184e061ed91d1"`);
        await queryRunner.query(`ALTER TABLE "social_pages" DROP CONSTRAINT "FK_7bd12fc0fa5142915e9e5e31fb7"`);
        await queryRunner.query(`ALTER TABLE "post_media" DROP CONSTRAINT "FK_4adcc5190e3b5c7e9001adef3b8"`);
        await queryRunner.query(`DROP TABLE "social_accounts"`);
        await queryRunner.query(`DROP TYPE "public"."social_accounts_status_enum"`);
        await queryRunner.query(`DROP TABLE "social_platforms"`);
        await queryRunner.query(`DROP TYPE "public"."social_platforms_status_enum"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP TABLE "password_reset_tokens"`);
        await queryRunner.query(`DROP TYPE "public"."password_reset_tokens_type_enum"`);
        await queryRunner.query(`DROP TABLE "activities"`);
        await queryRunner.query(`DROP TYPE "public"."activities_actortype_enum"`);
        await queryRunner.query(`DROP TABLE "admins"`);
        await queryRunner.query(`DROP TYPE "public"."admins_status_enum"`);
        await queryRunner.query(`DROP TYPE "public"."admins_role_enum"`);
        await queryRunner.query(`DROP TABLE "posts"`);
        await queryRunner.query(`DROP TYPE "public"."posts_status_enum"`);
        await queryRunner.query(`DROP TABLE "post_platforms"`);
        await queryRunner.query(`DROP TYPE "public"."post_platforms_platformstatus_enum"`);
        await queryRunner.query(`DROP TABLE "social_pages"`);
        await queryRunner.query(`DROP TABLE "post_media"`);
        await queryRunner.query(`DROP TYPE "public"."post_media_type_enum"`);
    }

}
