import { Body, Controller, Get, HttpCode, Inject, Post, Req, UnauthorizedException } from "@nestjs/common";
import { config } from "../config";
import { AuthService } from "./auth.service";
import { verifyToken } from "./jwt";

export function userFromRequest(req: any) {
  const h = String(req.headers?.authorization ?? "");
  return verifyToken(h.startsWith("Bearer ") ? h.slice(7) : "", config.jwtSecret);
}

@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() body: unknown, @Req() req: any) { return this.auth.register(body, req.ip); }

  @Post("google")
  @HttpCode(200)
  google(@Body() body: unknown, @Req() req: any) { return this.auth.google(body, req.ip); }

  @Post("login")
  @HttpCode(200)
  login(@Body() body: unknown) { return this.auth.login(body); }

  @Get("me")
  me(@Req() req: unknown) {
    const u = userFromRequest(req);
    if (!u) throw new UnauthorizedException();
    return { id: u.sub, name: u.name };
  }
}
