import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { config } from "../config";

function sameSecret(provided: unknown, expected: string): boolean {
  if (!expected || typeof provided !== "string") return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Admin endpoints: header `x-admin-key` must match ADMIN_API_KEY (rejects everything when unset). */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!sameSecret(req.headers["x-admin-key"], config.adminApiKey)) throw new UnauthorizedException();
    return true;
  }
}

/** Service-to-service endpoints used by ludo-game-server: header `x-internal-key`. */
@Injectable()
export class InternalGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    if (!sameSecret(req.headers["x-internal-key"], config.internalApiKey)) throw new UnauthorizedException();
    return true;
  }
}
