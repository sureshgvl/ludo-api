import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller";
import { TournamentsController } from "./tournaments.controller";
import { TournamentsService } from "./tournaments.service";

@Module({
  controllers: [TournamentsController, AdminController],
  providers: [TournamentsService],
  exports: [TournamentsService],
})
export class TournamentsModule {}
