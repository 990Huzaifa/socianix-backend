import { IsNotEmpty, IsUUID } from 'class-validator';

export class PublishPostDto {
  @IsUUID()
  @IsNotEmpty()
  postId: string;
}
