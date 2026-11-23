import { Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, UnauthorizedException } from "@nestjs/common";
import { userFromRequest } from "../auth/auth.controller";
import { config } from "../config";
import { TournamentsService } from "./tournaments.service";

/**
 * Player-facing endpoints.
 * When JWT_SECRET is set the player comes from the Bearer token; otherwise (dev) from the request.
 */
@Controller("tournaments")
export class TournamentsController {
  constructor(@Inject(TournamentsService) private readonly tournaments: TournamentsService) {}

  @Get()
  list(@Query("status") status?: string) {
    return this.tournaments.list(status);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.tournaments.get(id);
  }

  @Get(":id/leaderboard")
  leaderboard(@Param("id") id: string, @Query("limit") limit?: string) {
    return this.tournaments.leaderboard(id, limit ? Number(limit) : 50);
  }

  /** Prize winners of a finished tournament. */
  @Get(":id/awards")
  awards(@Param("id") id: string) {
    return this.tournaments.awards(id);
  }

  @Post(":id/entries")
  register(@Param("id") id: string, @Body() body: unknown, @Req() req: unknown) {
    if (config.jwtSecret) {
      const u = userFromRequest(req);
      if (!u) throw new UnauthorizedException("Log in first");
      return this.tournaments.register(id, { userId: u.sub, name: u.name });
    }
    return this.tournaments.register(id, body);
  }

  @Get(":id/entries/:userId")
  async entry(@Param("id") id: string, @Param("userId") userId: string) {
    const entry = await this.tournaments.entry(id, userId);
    if (!entry) throw new NotFoundException("Not registered");
    return entry;
  }

  @Delete(":id/entries/:userId")
  @HttpCode(204)
  async withdraw(@Param("id") id: string, @Param("userId") userId: string, @Req() req: unknown) {
    if (config.jwtSecret) {
      const u = userFromRequest(req);
      if (!u || u.sub !== userId) throw new UnauthorizedException();
    }
    await this.tournaments.withdraw(id, userId);
  }
}
