import { Body, Controller, Inject, Param, Post, UseGuards } from "@nestjs/common";
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
}
