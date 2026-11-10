import type { ConversionJob, ConversionLog, Layer, SourceFile } from "@prisma/client";

import { JobStatus, LayerStatus } from "@/lib/enums";
import { prisma } from "@/lib/prisma";
import type { JobRunContext } from "@/server/jobs/types";
import { logChannel, type LogChannel, type Logger } from "@/server/logger";
import { killConversionContainers } from "@/server/services/conversion/docker";
import { errorMessage, errorWithTrace } from "@/server/services/support";

/**
 * Shared behaviour of the conversion jobs (port of BaseConversionJob): step logging to the
 * terrain / vector channel, and failure handling that kills leftover converter containers, closes
 * the conversion_logs row and, on the final attempt only, marks the job failed and the layer
 * process_failed (a retried attempt must not make the UI report a terminal failure).
 */
export abstract class BaseConversionJob {
  protected logEntry: ConversionLog | null = null;
  protected layer: Layer | null = null;
  protected sourceFile: SourceFile | null = null;

  constructor(
    public conversionJob: ConversionJob,
    protected readonly layerName: string,
    protected readonly acquisitionDate: string | null = null,
    protected readonly context: JobRunContext = { attempt: 1, maxAttempts: 2 },
  ) {}

  protected abstract getLogChannel(): LogChannel;

  protected abstract getTotalSteps(): number;

  protected get logger(): Logger {
    return logChannel(this.getLogChannel());
  }

  /** Laravel's $this->attempts(). */
  protected attempts(): number {
    return this.context.attempt;
  }

  protected get signal(): AbortSignal | undefined {
    return this.context.signal;
  }

  protected willRetry(): boolean {
    return this.context.attempt < this.context.maxAttempts;
  }

  /** Starts a step; refuses once the reservation was given up (timeout or worker shutdown). */
  protected logStep(step: number, message: string): void {
    this.signal?.throwIfAborted();
    this.logger.info(`[STEP ${step}/${this.getTotalSteps()}] ${message}`);
  }

  protected logStepSuccess(step: number, operation: string, extra = ""): void {
    const label = step > 0 ? `[STEP ${step}/${this.getTotalSteps()}]` : "[STEP EXTRA]";
    this.logger.info(`${label} ${operation} SUCCESS${extra ? `. ${extra}` : ""}`);
  }

  protected logStepExtra(message: string): void {
    this.logger.info(`[STEP EXTRA] ${message}`);
  }

  protected async updateConversionJob(data: Parameters<typeof prisma.conversionJob.update>[0]["data"]): Promise<void> {
    this.conversionJob = await prisma.conversionJob.update({ where: { id: this.conversionJob.id }, data });
  }

  /** `final`: the queue has given up on the job (failed()); otherwise only the last attempt is terminal. */
  async handleFailure(error: unknown, { final = false }: { final?: boolean } = {}): Promise<void> {
    const logger = this.logger;
    logger.error(`Pipeline FAILED: ${errorMessage(error)}`);

    await this.cleanupDockerContainers();

    try {
      if (this.logEntry) {
        this.logEntry = await prisma.conversionLog.update({
          where: { id: this.logEntry.id },
          data: { finished_at: new Date(), exit_code: 1, stderr_log: errorWithTrace(error) },
        });
      }
    } catch (updateError) {
      logger.error(`Failed to update logEntry during job failure handling: ${errorMessage(updateError)}`);
    }

    if (!final && this.willRetry()) return;

    try {
      await prisma.conversionJob.updateMany({
        where: { id: this.conversionJob.id },
        data: { status: JobStatus.Failed, error_message: errorMessage(error), finished_at: new Date() },
      });
    } catch (updateError) {
      logger.error(`Failed to update conversionJob status during job failure handling: ${errorMessage(updateError)}`);
    }

    try {
      const layerId = this.layer?.id ?? (await prisma.layer.findUnique({ where: { job_id: this.conversionJob.id }, select: { id: true } }))?.id;
      if (layerId) {
        await prisma.layer.update({ where: { id: layerId }, data: { status: LayerStatus.ProcessFailed } });
      }
    } catch (updateError) {
      logger.error(`Failed to update layer status during job failure handling: ${errorMessage(updateError)}`);
    }
  }

  /** Called by the queue once the job failed for good (timeout, crash, last attempt). */
  async failed(error: unknown): Promise<void> {
    await this.handleFailure(error, { final: true });
  }

  protected async cleanupDockerContainers(): Promise<void> {
    if (!this.conversionJob?.id) return;
    await killConversionContainers(this.conversionJob.id, this.logger);
  }
}
