/**
 * Loads .env / .env.local the same way `next dev` does. Import this FIRST in entry points that
 * run outside Next.js (queue worker, seed and CLI scripts) so `@/env` sees the variables.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production");
