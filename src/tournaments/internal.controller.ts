import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { InternalGuard } from "../auth/guards";
import { TournamentsService } from "./tournaments.service";

/** Called by ludo-game-server only. Requires the `x-internal-key` header. */
@Controller("internal")
@UseGuards(InternalGuard)
export class InternalController {
  constructor(@Inject(TournamentsService) private readonly tournaments: TournamentsService) {}

  @Get("tournaments/:id/eligibility/:userId")
  eligibility(@Param("id") id: string, @Param("userId") userId: string) {
    return this.tournaments.eligibility(id, userId);
  }

  /** A finished game. Idempotent per gameId. */
  @Post("games")
  @HttpCode(200)
  recordGame(@Body() body: unknown) {
    return this.tournaments.recordGame(body);
  }
}
