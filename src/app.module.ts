import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// Planned modules: auth, users, tournaments, leaderboards, prizes, admin.
@Module({
  controllers: [HealthController],
})
export class AppModule {}
