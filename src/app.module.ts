import { Module } from "@nestjs/common";
import { DatabaseModule } from "./db/database.module";
import { HealthController } from "./health.controller";
import { TournamentsModule } from "./tournaments/tournaments.module";

// Still to come: auth and users, notifications.
@Module({
  imports: [DatabaseModule, TournamentsModule],
  controllers: [HealthController],
})
export class AppModule {}
