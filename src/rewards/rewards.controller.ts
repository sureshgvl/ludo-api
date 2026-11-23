import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UnauthorizedException, UseGuards } from "@nestjs/common";
import { InternalGuard } from "../auth/guards";
import { userFromRequest } from "../auth/auth.controller";
import { config } from "../config";
import { RewardsService } from "./rewards.service";

/** Player from the login token; in dev (no JWT_SECRET) from ?userId=. */
function who(req: any, query?: string): string {
  if (config.jwtSecret) {
    const u = userFromRequest(req);
    if (!u) throw new UnauthorizedException("Log in first");
    return u.sub;
  }
  if (!query) throw new UnauthorizedException("userId required");
  return query;
}

@Controller()
export class RewardsController {
  constructor(@Inject(RewardsService) private readonly rewards: RewardsService) {}

  @Get("me/wallet")
  wallet(@Req() req: any, @Query("userId") q?: string) { return this.rewards.wallet(who(req, q)); }

  @Post("me/daily-bonus")
  @HttpCode(200)
  daily(@Req() req: any, @Query("userId") q?: string) { return this.rewards.claimDaily(who(req, q)); }

  @Get("me/history")
  history(@Req() req: any, @Query("userId") q?: string, @Query("limit") limit?: string) {
    return this.rewards.history(who(req, q), limit ? Number(limit) : 50);
  }

  @Get("leaderboard/:period")
  async board(@Param("period") period: string, @Req() req: any, @Query("userId") q?: string) {
    if (period !== "daily" && period !== "weekly" && period !== "all") throw new BadRequestException("period must be daily, weekly or all");
    let me: string | undefined;
    try { me = who(req, q); } catch { me = undefined; }
    return this.rewards.leaderboard(period, me);
  }

  /** Every finished game, called by ludo-game-server. */
  @Post("internal/results")
  @HttpCode(200)
  @UseGuards(InternalGuard)
  result(@Body() body: unknown) { return this.rewards.recordGame(body); }
}
