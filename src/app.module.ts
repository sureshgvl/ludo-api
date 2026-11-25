import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./db/database.module";
import { HealthController } from "./health.controller";
import { FriendsModule } from "./friends/friends.module";
import { RewardsModule } from "./rewards/rewards.module";
import { TournamentsModule } from "./tournaments/tournaments.module";

// Still to come: notifications.
@Module({
  imports: [DatabaseModule, AuthModule, TournamentsModule, RewardsModule, FriendsModule],
  controllers: [HealthController],
})
export class AppModule {}
