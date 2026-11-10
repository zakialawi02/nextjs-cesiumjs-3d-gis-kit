/**
 * Chunked, resumable upload client (port of resources/js/upload/chunked-upload.js).
 * No CSRF header: the Next.js route handlers check the request Origin instead.
 */
import { setPauseResumeIcon } from './upload-wiring.js';
class UploadError extends Error {
    constructor(message, status = 0, retryAfter = 0) {
        super(message);
        this.status = status;
        this.retryAfter = retryAfter;
    }
    get retryable() { return this.status === 0 || this.status === 408 || this.status === 429 || this.status >= 500; }
}

function generateUploadId() {
    return 'upload_' + crypto.randomUUID();
}

async function uploadRequestJson(url, options = {}, { signal, timeout = 45000 } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timer = setTimeout(abort, timeout);
    try {
        const response = await fetch(url, {
            ...options, credentials: 'same-origin', redirect: 'error', signal: controller.signal,
            headers: { Accept: 'application/json', ...options.headers },
        });
        const isJson = response.headers.get('content-type')?.includes('application/json');
        let data = null;
        if (isJson) {
            try { data = await response.json(); } catch {
                if (response.ok) throw new UploadError('The server returned an invalid upload response.', 422);
            }
        }
        if (!response.ok) {
            const seconds = Number(response.headers.get('retry-after'));
            const retryAfter = Number.isFinite(seconds) ? seconds * 1000 : 0;
            throw new UploadError(data?.message || `Upload request failed (${response.status}).`, response.status, retryAfter);
        }
        if (!data || data.success !== true) throw new UploadError('The server returned an invalid upload response.', 422);
        return data;
    } catch (error) {
        if (signal?.aborted) throw new Error('CANCELLED');
        if (error instanceof UploadError) throw error;
        throw new UploadError(controller.signal.aborted ? 'Upload request timed out.' : 'Unable to reach the upload server.');
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const retryDelay = (attempt, error) => Math.max(error.retryAfter || 0, Math.min(1000 * 2 ** attempt, 15000) + Math.random() * 500);
const readResume = key => { try { return localStorage.getItem(key); } catch { return null; } };
const writeResume = (key, id) => { try { localStorage.setItem(key, id); } catch { /* Storage may be disabled. */ } };
const forgetResume = key => { try { localStorage.removeItem(key); localStorage.removeItem(key + ':request'); } catch { /* Storage may be disabled. */ } };

async function uploadFileInChunks(file, progressCallback, uploadId, uploadStates, { chunkUploadUrl = '/dashboard/upload/chunk' } = {}) {
    if (!crypto.subtle) throw new Error('Secure uploads require HTTPS or localhost.');
    if (!file.size) throw new Error('The selected file is empty.');
    const baseUrl = chunkUploadUrl.replace(/\/chunk$/, '/sessions');
    const key = 'geodata-upload:' + JSON.stringify([file.name, file.size, file.lastModified]);
    let state = uploadStates.get(uploadId);
    if (!state) {
        state = { paused: false, cancelled: false, abortController: new AbortController(), status: 'uploading', sessions: new Map() };
        state.cancel = async () => {
            state.cancelled = true;
            state.abortController.abort();
            await Promise.all([...state.sessions].map(async ([id, resumeKey]) => {
                await uploadRequestJson(`${baseUrl}/${id}`, { method: 'DELETE' });
                forgetResume(resumeKey);
            }));
        };
        uploadStates.set(uploadId, state);
    }
    if (state.cancelled) throw new Error('CANCELLED');
    let session;
    const saved = readResume(key);
    if (saved) {
        try {
            session = (await uploadRequestJson(`${baseUrl}/${encodeURIComponent(saved)}`, {}, { signal: state.abortController.signal })).session;
            if (!['uploading', 'queued', 'assembled'].includes(session.status)) session = null;
        } catch (error) {
            if (![404, 410].includes(error.status)) throw error;
        }
        if (!session) forgetResume(key);
    }
    if (!session) {
        const requestId = readResume(key + ':request') || crypto.randomUUID();
        writeResume(key + ':request', requestId);
        try {
            session = (await uploadRequestJson(baseUrl, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileName: file.name, fileSize: file.size, requestId }),
            }, { signal: state.abortController.signal })).session;
        } catch (error) {
            if (error.status === 410) forgetResume(key);
            throw error;
        }
        writeResume(key, session.identifier);
    }
    if (session.fileName !== file.name || session.fileSize !== file.size) throw new Error('The saved upload does not match the selected file.');
    state.sessions.set(session.identifier, key);
    if (!['uploading', 'queued', 'assembled'].includes(session.status)) {
        forgetResume(key);
        throw new Error('The saved upload is no longer active. Select the file again to start a new upload.');
    }
    const { identifier, chunkSize, totalChunks } = session;
    if (session.status !== 'uploading') return { identifier, fileName: file.name, totalChunks };
    for (let index = 0; index < totalChunks; index++) {
        if (state.cancelled) throw new Error('CANCELLED');
        while (state.paused) {
            if (state.cancelled) throw new Error('CANCELLED');
            await delay(250);
        }
        const chunk = file.slice(index * chunkSize, Math.min(file.size, (index + 1) * chunkSize));
        const digest = await crypto.subtle.digest('SHA-256', await chunk.arrayBuffer());
        const checksum = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
        if (session.chunks[index] && session.chunks[index] !== checksum) {
            throw new Error('File contents differ from the saved upload. Cancel it before uploading a different file.');
        }
        if (!session.chunks[index]) {
            let attempt = 0;
            for (;;) {
                if (state.cancelled) throw new Error('CANCELLED');
                try {
                    const body = new FormData();
                    body.append('file', chunk);
                    body.append('identifier', identifier);
                    body.append('chunkIndex', index);
                    body.append('checksum', checksum);
                    await uploadRequestJson(chunkUploadUrl, { method: 'POST', body }, { signal: state.abortController.signal });
                    break;
                } catch (error) {
                    if (error.message === 'CANCELLED' || !error.retryable) throw error;
                    if (++attempt >= 5) {
                        state.paused = true;
                        const item = document.getElementById(uploadId);
                        const label = item?.querySelector('.progress-label');
                        const button = item?.querySelector('.pause-resume-btn');
                        if (label) label.textContent = 'Connection interrupted. Resume to retry.';
                        if (button) {
                            button.title = 'Resume upload';
                            setPauseResumeIcon(button, true);
                        }
                        while (state.paused) {
                            if (state.cancelled) throw new Error('CANCELLED');
                            await delay(250);
                        }
                        attempt = 0;
                    } else await delay(retryDelay(attempt, error));
                }
            }
        }
        progressCallback?.(index + 1, totalChunks);
    }
    return { identifier, fileName: file.name, totalChunks };
}

async function submitGeodataUpload(url, payload, state) {
    for (let attempt = 0; ; attempt++) {
        try {
            const result = await uploadRequestJson(url, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
            });
            if (state) {
                state.status = 'processing';
                for (const key of state.sessions.values()) forgetResume(key);
            }
            return result;
        } catch (error) {
            if (!error.retryable || attempt >= 4) throw error;
            await delay(retryDelay(attempt, error));
        }
    }
}

function escapeUploadText(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function markUploadFailed(uploadId, uploadStates, progressItem) {
    const state = uploadStates.get(uploadId);
    if (state) state.status = 'failed';
    const pause = progressItem?.querySelector('.pause-resume-btn');
    if (pause) pause.hidden = true;
}

export { uploadFileInChunks, generateUploadId, uploadRequestJson, submitGeodataUpload, escapeUploadText, markUploadFailed };
