/**
 * Conversion job polling and progress label states (port of resources/js/upload/poll-job-status.js).
 */
import { uploadRequestJson } from './chunked-upload.js';

function pollJobStatus(jobId, { interval = 4000, onProcessing, onDone, onFail, statusBaseUrl = '/dashboard/upload/status/' } = {}, timers = []) {
    let pending = false;
    let failures = 0;
    let nextAttempt = 0;
    const timer = setInterval(async () => {
        if (pending || Date.now() < nextAttempt) return;
        pending = true;
        const stopPolling = () => {
            clearInterval(timer);
            const idx = timers.indexOf(timer);
            if (idx > -1) timers.splice(idx, 1);
        };
        try {
            const data = await uploadRequestJson(`${statusBaseUrl}${jobId}`, {}, { timeout: 15000 });
            failures = 0;
            if (data.status === 'processing') {
                onProcessing?.();
            } else if (data.status === 'done') {
                stopPolling();
                onDone?.();
            } else if (data.status === 'failed') {
                stopPolling();
                onFail?.(data.error_message || 'Processing failed');
            }
        } catch (error) {
            if (error.retryable) {
                failures++;
                nextAttempt = Date.now() + Math.max(error.retryAfter || 0, Math.min(interval * 2 ** Math.min(failures, 4), 60000));
            } else {
                stopPolling();
                onFail?.(`Unable to check status. Job ${jobId} continues on the server; sign in again to check it.`);
            }
        } finally {
            pending = false;
        }
    }, interval);
    timers.push(timer);
    return timer;
}

function setProgressState(label, state, message) {
    if (!label) return;
    if (message !== undefined) label.textContent = message;

    const stateClasses = {
        processing: ['text-foreground/70', 'italic', 'animate-pulse'],
        success: ['text-success', 'font-bold'],
        error: ['text-error', 'font-bold'],
        queued: ['text-foreground/70', 'italic'],
        default: ['text-foreground/70', 'italic']
    };

    const allStateClasses = Array.from(new Set(Object.values(stateClasses).flat()));
    label.classList.remove(...allStateClasses);

    const classesToAdd = stateClasses[state] || stateClasses.default;
    label.classList.add(...classesToAdd);
}

export { pollJobStatus, setProgressState };
