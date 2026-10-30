import "reflect-metadata";
import { config } from "dotenv";
import path from "node:path";
import { rootDir } from "./config";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
config({ path: path.join(rootDir(), "apps/api/.env") });

// Serving processes must never retain deployment signer credentials, including API dotenv.
for (const key of Object.keys(process.env)) {
  if (/PRIVATE_KEY|MNEMONIC|DEPLOYER_KEY/i.test(key)) delete process.env[key];
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("api");
  app.enableCors({
    origin: (
      process.env.CORS_ORIGINS ||
      "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174"
    ).split(","),
  });
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 3000), "0.0.0.0");
}
bootstrap().catch(() => {
  console.error("API startup failed; check database and configuration");
  process.exitCode = 1;
});
