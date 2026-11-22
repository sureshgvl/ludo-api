import { createApp } from "./app";
import { config } from "./config";

async function bootstrap() {
  const app = await createApp();
  await app.listen(config.port);
  console.log(`ludo-api listening on :${config.port}`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
