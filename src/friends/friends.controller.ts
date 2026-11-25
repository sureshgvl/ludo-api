import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { userFromRequest } from "../auth/auth.controller";
import { config } from "../config";
import { FriendsService } from "./friends.service";

function who(req: any, query?: string): string {
  if (config.jwtSecret) {
    const u = userFromRequest(req);
    if (!u) throw new UnauthorizedException("Log in first");
    return u.sub;
  }
  if (!query) throw new UnauthorizedException("userId required");
  return query;
}

@Controller("me/friends")
export class FriendsController {
  constructor(@Inject(FriendsService) private readonly friends: FriendsService) {}

  @Get()
  list(@Req() req: any, @Query("userId") q?: string) { return this.friends.list(who(req, q)); }

  @Post()
  @HttpCode(200)
  add(@Req() req: any, @Body() body: { code?: unknown }, @Query("userId") q?: string) { return this.friends.add(who(req, q), body?.code); }

  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: any, @Query("userId") q?: string) { return this.friends.remove(who(req, q), id); }
}
