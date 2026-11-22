import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { config } from "./config";

export async function createApp(options: { logger?: false } = {}): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, options);
  app.setGlobalPrefix("api");
  app.enableCors({ origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(",") });
  app.enableShutdownHooks();
  return app;
}
