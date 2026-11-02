import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';

import { isInternalRequest } from './internal-listener';

/** Makes a route answer only on the internal listener; elsewhere it is a 404. */
@Injectable()
export class InternalListenerGuard implements CanActivate {
  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!isInternalRequest(request)) {
      throw new NotFoundException();
    }

    return true;
  }
}
