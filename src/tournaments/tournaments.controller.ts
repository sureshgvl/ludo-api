import { Body, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Post, Query } from "@nestjs/common";
import { TournamentsService } from "./tournaments.service";

/**
 * Player-facing endpoints.
 * TODO: take the user from an auth token instead of the request body / path.
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

  @Post(":id/entries")
  register(@Param("id") id: string, @Body() body: unknown) {
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
  async withdraw(@Param("id") id: string, @Param("userId") userId: string) {
    await this.tournaments.withdraw(id, userId);
  }
}
