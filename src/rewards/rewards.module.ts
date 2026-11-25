import { Module } from "@nestjs/common";
import { RewardsController } from "./rewards.controller";
import { MissionsService } from "./missions.service";
import { RewardsService } from "./rewards.service";

@Module({ controllers: [RewardsController], providers: [RewardsService, MissionsService], exports: [RewardsService] })
export class RewardsModule {}
