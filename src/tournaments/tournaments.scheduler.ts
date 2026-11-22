import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { config } from "../config";
import { TournamentsService } from "./tournaments.service";

/** Starts and finishes tournaments on time. Safe to run on several servers at once. */
@Injectable()
export class TournamentsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TournamentsScheduler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@Inject(TournamentsService) private readonly tournaments: TournamentsService) {}

  onModuleInit(): void {
    if (config.disableScheduler) return;
    const run = () =>
      this.tournaments.tick().catch((err) => this.log.error(`tick failed: ${err?.message ?? err}`));
    void run();
    this.timer = setInterval(run, config.schedulerIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
