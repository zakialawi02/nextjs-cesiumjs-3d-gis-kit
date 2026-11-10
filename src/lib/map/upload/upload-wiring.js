import { setIcon } from "@/lib/icons";

/** Shows the pause or play icon on a pause/resume button of an upload progress card. */
export function setPauseResumeIcon(button, paused) {
    const icon = button.querySelector('[data-icon]');
    if (icon) setIcon(icon, paused ? 'play' : 'pause', { className: 'text-sm' });
}

/**
 * Pause / resume / cancel / dismiss buttons of the upload progress cards (port of resources/js/upload/upload-wiring.js).
 * onCancel(uploadId, progressItem, state) removes a cancelled card; onDismiss(uploadId) runs after a
 * dismissed card is removed. Returns a function that removes the delegated listener.
 */
function wireUploadControls(activeUploadsList, uploadStates, {
    cancelBtnClass = 'cancel-upload-btn',
    onCancel,
    onDismiss,
} = {}) {
    const onClick = async (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;

        const progressItem = btn.closest('[id^="upload_"]');
        if (!progressItem) return;

        const uploadId = progressItem.id;

        if (btn.classList.contains('dismiss-btn')) {
            uploadStates.delete(uploadId);
            progressItem.classList.add('opacity-0', 'transition-opacity', 'duration-300');
            setTimeout(() => {
                progressItem.remove();
                onDismiss?.(uploadId);
            }, 300);
            return;
        }

        const state = uploadStates.get(uploadId);
        if (!state) return;

        if (btn.classList.contains('pause-resume-btn')) {
            state.paused = !state.paused;
            const label = progressItem.querySelector('.progress-label');
            setPauseResumeIcon(btn, state.paused);

            if (state.paused) {
                if (label) label.textContent = 'Paused...';
                btn.title = 'Resume Upload';
            } else {
                if (label) label.textContent = 'Uploading...';
                btn.title = 'Pause Upload';
            }
        } else if (btn.classList.contains(cancelBtnClass)) {
            if (confirm('Cancel this upload?')) {
                btn.disabled = true;
                try {
                    await state.cancel();
                    uploadStates.delete(uploadId);
                    if (onCancel) onCancel(uploadId, progressItem, state);
                    else progressItem.remove();
                } catch {
                    const label = progressItem.querySelector('.progress-label');
                    if (label) label.textContent = 'Cancellation could not be confirmed. Click cancel to retry.';
                } finally {
                    btn.disabled = false;
                }
            }
        }
    };
    activeUploadsList.addEventListener('click', onClick);
    return () => activeUploadsList.removeEventListener('click', onClick);
}

export default wireUploadControls;
