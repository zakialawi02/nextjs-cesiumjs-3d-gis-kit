import { mkdir } from "node:fs/promises";
import path from "node:path";

import { geodataConfig } from "@/config/geodata";
import { DISK_ROOTS } from "@/server/storage";
import type { Logger } from "@/server/logger";
import { runProcess, type ProcessResult } from "@/server/services/process";
import { errorMessage } from "@/server/services/support";

/** Laravel's base_path(): docker-compose.tools.yml bind mounts are relative to it. */
export const PROJECT_ROOT = process.cwd();

/** Process timeout of every converter run (Laravel: Process::timeout(7200)). */
export const CONVERTER_TIMEOUT_MS = 7200 * 1000;

export type DockerRunOptions = {
  /** Labels the container `conversion_job_id=<id>` so leftovers can be killed on failure. */
  jobId?: string | null;
  /** Extra `docker compose run` options placed before the label (e.g. `-v` mounts). */
  runOptions?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
};

/** "docker compose" / "docker-compose" split into executable + leading arguments. */
export function dockerComposeCommand(): { command: string; args: string[] } {
  const [command, ...args] = geodataConfig.dockerComposeBin.split(" ").filter(Boolean);
  return { command: command ?? "docker", args };
}

/** `docker compose -f <file> run --rm [options] [-l conversion_job_id=<id>] <service> <tool...>` */
export function dockerComposeRunArgs(service: string, toolCommand: string[], options: DockerRunOptions = {}): string[] {
  const { args } = dockerComposeCommand();
  const command = [...args, "-f", geodataConfig.dockerComposeFile, "run", "--rm", ...(options.runOptions ?? [])];
  if (options.jobId) command.push("-l", `conversion_job_id=${options.jobId}`);
  command.push(service, ...toolCommand);
  return command;
}

/**
 * The bind-mount sources of docker-compose.tools.yml. If one is missing, Docker creates it owned by
 * root on Linux and the worker can no longer write into it, so create them as the worker user first.
 */
const BIND_MOUNT_DIRS = [
  path.join(DISK_ROOTS.geodata),
  path.join(DISK_ROOTS.public, "terrain-tiles"),
  path.join(DISK_ROOTS.public, "xyz-tiles"),
];

export async function runDockerCompose(service: string, toolCommand: string[], options: DockerRunOptions = {}): Promise<ProcessResult> {
  await Promise.all(BIND_MOUNT_DIRS.map((dir) => mkdir(dir, { recursive: true })));
  const { command } = dockerComposeCommand();
  return runProcess(command, dockerComposeRunArgs(service, toolCommand, options), {
    cwd: PROJECT_ROOT,
    timeoutMs: options.timeoutMs ?? CONVERTER_TIMEOUT_MS,
    signal: options.signal,
  });
}

/**
 * Kills containers still running for a conversion job (BaseConversionJob::cleanupDockerContainers).
 * Errors are logged, never thrown.
 */
export async function killConversionContainers(jobId: string, logger: Logger): Promise<void> {
  try {
    const result = await runProcess("docker", ["ps", "-q", "--filter", `label=conversion_job_id=${jobId}`], {
      timeoutMs: 60_000,
    });
    const ids = result.stdout
      .replace(/\r/g, "")
      .split("\n")
      .map((id) => id.trim())
      .filter((id) => /^[0-9a-f]{6,64}$/i.test(id));
    for (const id of ids) {
      await runProcess("docker", ["kill", id], { timeoutMs: 60_000 });
      logger.info(`Killed orphaned Docker container: ${id}`);
    }
  } catch (error) {
    logger.error(`Failed to cleanup Docker containers: ${errorMessage(error)}`);
  }
}
