import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostPlatformMetadata1785000000000 implements MigrationInterface {
  name = 'AddPostPlatformMetadata1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "post_platforms" ADD "metadata" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "post_platforms" DROP COLUMN "metadata"`,
    );
  }
}
