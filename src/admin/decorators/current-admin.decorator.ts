import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Admin } from '../../entities/admin.entity';

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Admin => {
    const request = context.switchToHttp().getRequest<{ user: Admin }>();
    return request.user;
  },
);
