import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { InternalController } from "./internal.controller";
import { TournamentsController } from "./tournaments.controller";
import { TournamentsScheduler } from "./tournaments.scheduler";
import { TournamentsService } from "./tournaments.service";

@Module({
  controllers: [TournamentsController, AdminController, InternalController],
  providers: [TournamentsService, TournamentsScheduler],
  exports: [TournamentsService],
})
export class TournamentsModule {}
