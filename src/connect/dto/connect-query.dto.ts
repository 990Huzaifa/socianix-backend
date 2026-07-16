import { IsIn, IsString } from 'class-validator';
import { CONNECT_PLATFORMS } from '../connect-platform.type';
import type { ConnectPlatform } from '../connect-platform.type';

export class ConnectQueryDto {
  @IsString()
  @IsIn(CONNECT_PLATFORMS)
  platform: ConnectPlatform;
}
