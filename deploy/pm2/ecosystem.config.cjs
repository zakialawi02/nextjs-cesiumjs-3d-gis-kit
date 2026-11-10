/**
 * PM2 alternative to the systemd units in deploy/systemd: the web process (`next start`) and the
 * queue worker. Run from the project root as the service user:
 *
 *   pm2 start deploy/pm2/ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup systemd -u gis --hp /home/gis   # prints the command that enables PM2 at boot
 *
 * Both processes load .env from the project root themselves (Next.js, and src/server/load-env.ts
 * in the worker); `env` below only adds or overrides variables. The worker runs through tsx
 * (a regular dependency), and the user must be in the `docker` group.
 *
 * PM2 stops a process with SIGINT and kills it after `kill_timeout` ms. The worker handles SIGINT
 * like SIGTERM: kill_timeout must exceed WORKER_SHUTDOWN_TIMEOUT_MS + 20 s.
 */
// Project root: this file lives in <root>/deploy/pm2.
const root = `${__dirname}/../..`;

module.exports = {
  apps: [
    {
      name: "gis-kit-web",
      cwd: root,
      // Same as `npm start` (next start), bound to localhost behind Nginx.
      script: "node_modules/next/dist/bin/next",
      args: "start --hostname 127.0.0.1 --port 3000 --keepAliveTimeout 65000",
      interpreter: "node",
      env: {
        NODE_ENV: "production",
      },
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 10000,
    },
    {
      name: "gis-kit-worker",
      cwd: root,
      // Same as `npm run worker` (tsx src/worker/index.ts).
      script: "src/worker/index.ts",
      interpreter: "node",
      node_args: ["--import", "tsx"],
      env: {
        NODE_ENV: "production",
        WORKER_SHUTDOWN_TIMEOUT_MS: "60000",
      },
      autorestart: true,
      restart_delay: 5000,
      kill_timeout: 90000,
    },
  ],
};
