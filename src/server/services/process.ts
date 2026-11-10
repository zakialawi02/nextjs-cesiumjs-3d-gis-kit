import { spawn } from "node:child_process";

/**
 * Port of Laravel's Process::run() for external tools: arguments are passed as an array (no
 * shell), output is collected, and the command is killed when it exceeds its timeout (which, as
 * with Symfony Process, throws) or when `signal` aborts.
 */
export type ProcessResult = {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  successful: boolean;
};

export type RunProcessOptions = {
  cwd?: string;
  /** Milliseconds; 0 disables the timeout. */
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
};

/** Per-stream cap so a chatty tool cannot exhaust the worker's memory. */
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;

export class ProcessTimedOutError extends Error {}
export class ProcessAbortedError extends Error {}

export function describeCommand(command: string, args: string[]): string {
  return [command, ...args].map((part) => (/[\s"]/.test(part) ? JSON.stringify(part) : part)).join(" ");
}

export function runProcess(command: string, args: string[], options: RunProcessOptions = {}): Promise<ProcessResult> {
  const { cwd, timeoutMs = 60_000, signal, env } = options;
  const description = describeCommand(command, args);

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ProcessAbortedError(`The process "${description}" was aborted before it started.`));
      return;
    }

    const child = spawn(command, args, {
      cwd,
      env: env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let failure: Error | null = null;

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdoutBytes < MAX_OUTPUT_BYTES) stdout.push(chunk);
      stdoutBytes += chunk.length;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderrBytes < MAX_OUTPUT_BYTES) stderr.push(chunk);
      stderrBytes += chunk.length;
    });

    const stop = (error: Error) => {
      if (failure) return;
      failure = error;
      child.kill("SIGKILL");
    };

    const timer =
      timeoutMs > 0
        ? setTimeout(
            () => stop(new ProcessTimedOutError(`The process "${description}" exceeded the timeout of ${timeoutMs / 1000} seconds.`)),
            timeoutMs,
          )
        : null;
    const onAbort = () => stop(new ProcessAbortedError(`The process "${description}" was aborted.`));
    signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (error: Error | null, exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
        return;
      }
      resolve({
        command: description,
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        successful: exitCode === 0,
      });
    };

    child.on("error", (error) => finish(error, null));
    child.on("close", (code) => finish(failure, code));
  });
}
