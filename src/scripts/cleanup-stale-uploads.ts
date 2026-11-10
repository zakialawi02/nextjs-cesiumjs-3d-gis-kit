import "@/server/load-env";

import { prisma } from "@/lib/prisma";
import type { Logger } from "@/server/logger";
import { errorMessage } from "@/server/services/support";
import { cleanupStaleUploads } from "@/server/services/upload/cleanup-stale-uploads";

/**
 * `npm run geodata:cleanup-stale [-- --hours=20]` (port of `php artisan geodata:cleanup-stale`).
 * The worker runs the same cleanup every 30 minutes.
 */
const consoleLogger: Logger = {
  debug: (message) => console.log(message),
  info: (message) => console.log(message),
  warning: (message) => console.warn(message),
  error: (message) => console.error(message),
};

function hoursOption(argv: string[]): number {
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument.startsWith("--hours=")) return Number(argument.slice("--hours=".length));
    if (argument === "--hours") return Number(argv[i + 1]);
  }
  return 20;
}

async function main(): Promise<number> {
  const hours = hoursOption(process.argv.slice(2));
  if (!Number.isInteger(hours) || hours < 1) {
    console.error("The hours option must be positive.");
    return 1;
  }
  await cleanupStaleUploads({ hours, logger: consoleLogger });
  return 0;
}

main()
  .then(async (code) => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (error: unknown) => {
    console.error(errorMessage(error));
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
