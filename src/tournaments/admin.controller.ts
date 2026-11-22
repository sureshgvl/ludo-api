import { Body, Controller, Get, HttpCode, Inject, Param, Post, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../auth/guards";
import { TournamentsService } from "./tournaments.service";

/** Used by ludo-admin-panel. Requires the `x-admin-key` header. */
@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(@Inject(TournamentsService) private readonly tournaments: TournamentsService) {}

  @Post("tournaments")
  create(@Body() body: unknown) {
    return this.tournaments.create(body);
  }

  @Post("tournaments/:id/cancel")
  cancel(@Param("id") id: string) {
    return this.tournaments.cancel(id);
  }

  @Get("tournaments/:id/awards")
  awards(@Param("id") id: string) {
    return this.tournaments.awards(id);
  }

  /** Mark a prize as handed over to the winner. */
  @Post("tournaments/:id/awards/:userId/delivered")
  @HttpCode(200)
  delivered(@Param("id") id: string, @Param("userId") userId: string) {
    return this.tournaments.markAwardDelivered(id, userId);
  }

  /** Run the lifecycle check now instead of waiting for the scheduler. */
  @Post("tick")
  @HttpCode(200)
  tick() {
    return this.tournaments.tick();
  }
}
