/**
 * Map page script (port of the inline <script> of resources/views/pages/map/index.blade.php):
 * keyboard shortcuts, layer list, recent uploads and upload submission with progress cards.
 *
 * Shared state lives in the map store (src/stores/map-store.ts). React renders the side panels,
 * nav buttons, upload badge, account menu, layer filters and upload modal from it; this script
 * reacts to it (layer list, recent uploads) and records the running uploads in it.
 *
 * initMapPageScript() replaces the DOMContentLoaded handler and returns a cleanup function that
 * removes every listener, timer and store subscription it added (src/lib/map/mount.js calls it).
 */
import { escapeHtml, matchMonthYear, safeColor } from "@/lib/client/helpers";
import { iconSvg } from "@/lib/icons";
import { mapStore } from "@/stores/map-store";

import { CONFIG } from "./cesium-map";
import { layerCard, accordionGroupData, groupDot, uploadProgressCard, loadingSpinner, skeleton } from "./templates";
import { closeModal } from "./ui-interactions";
import { uploadFileInChunks, generateUploadId, submitGeodataUpload, markUploadFailed } from "./upload/chunked-upload";
import { pollJobStatus, setProgressState } from "./upload/poll-job-status";
import wireUploadControls from "./upload/upload-wiring";

const UPLOADING_MESSAGE = 'Uploads are still in progress. If you leave now, the upload will be cancelled. Are you sure you want to leave?';
const PROCESSING_MESSAGE = 'Background processing is running on the server and can be left safely. You are safe to leave or close this page.';

export function initMapPageScript() {
    // Managed event listeners helper for SPA-like cleanup support
    const _pageListeners = [];
    const activePollTimers = [];
    const pageTimeouts = new Set();
    const cleanupCallbacks = [];
    let disposed = false;
    // Layer list requests: responses of older requests (filters changed meanwhile) are ignored.
    let layersRequestSeq = 0;

    function addPageEventListener(target, type, listener, options) {
        if (target) {
            target.addEventListener(type, listener, options);
            _pageListeners.push({
                target,
                type,
                listener,
                options
            });
        }
    }

    function cleanupPageListeners() {
        _pageListeners.forEach(({
            target,
            type,
            listener,
            options
        }) => {
            if (target && typeof target.removeEventListener === 'function') {
                target.removeEventListener(type, listener, options);
            }
        });
        _pageListeners.length = 0;
    }

    /** setTimeout that is cancelled when the page is cleaned up. */
    function later(callback, ms) {
        const timer = setTimeout(() => {
            pageTimeouts.delete(timer);
            if (!disposed) callback();
        }, ms);
        pageTimeouts.add(timer);
        return timer;
    }

    /** Calls onChange(value, state) when selector(state) changes; unsubscribed on cleanup. */
    function watchStore(selector, onChange) {
        const unsubscribe = mapStore.subscribe((state, previous) => {
            if (disposed) return;
            const value = selector(state);
            if (!Object.is(value, selector(previous))) onChange(value, state);
        });
        cleanupCallbacks.push(unsubscribe);
    }

    function cleanupMapPage() {
        disposed = true;
        activePollTimers.forEach(t => clearInterval(t));
        activePollTimers.length = 0;
        pageTimeouts.forEach(t => clearTimeout(t));
        pageTimeouts.clear();
        cleanupPageListeners();
        cleanupCallbacks.splice(0).forEach(callback => {
            try {
                callback();
            } catch (error) {
                console.warn('Map page cleanup step failed:', error);
            }
        });
    }

    // pollJobStatus and setProgressState come from ./upload/poll-job-status.js

    // Side panels: React renders them from mapStore.activePanel (src/components/map). Opening the
    // Data panel loads the recent uploads; the Refresh button bumps recentUploadsRequest.
    watchStore(state => state.activePanel, panel => {
        if (panel === 'data') fetchRecentUploads();
    });
    watchStore(state => state.recentUploadsRequest, () => fetchRecentUploads());
    if (mapStore.getState().activePanel === 'data') fetchRecentUploads();

    // Keyboard: L / D toggle panels, Escape closes them (ignored while typing).
    const panelShortcuts = { l: 'layers', d: 'data' };
    addPageEventListener(document, 'keydown', (e) => {
        if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
        const target = e.target;
        if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return;
        if (document.querySelector('[data-modal][aria-hidden="false"]')) return;

        const { activePanel, closePanels, togglePanel } = mapStore.getState();
        if (e.key === 'Escape') {
            if (activePanel) closePanels();
            return;
        }

        const panelName = panelShortcuts[e.key.toLowerCase()];
        // The Data panel is only rendered for users who can upload.
        if (panelName && document.getElementById(`${panelName}Panel`) && !e.repeat) {
            e.preventDefault();
            togglePanel(panelName);
        }
    });

    const coordWgsGroup = document.getElementById('coordWgsGroup');
    const coordUtmGroup = document.getElementById('coordUtmGroup');

    function updateCoordinateDisplay(isUtm) {
        if (coordWgsGroup && coordUtmGroup) {
            if (isUtm) {
                coordWgsGroup.classList.remove('flex');
                coordWgsGroup.classList.add('hidden');
                coordUtmGroup.classList.remove('hidden');
                coordUtmGroup.classList.add('flex');
            } else {
                coordUtmGroup.classList.remove('flex');
                coordUtmGroup.classList.add('hidden');
                coordWgsGroup.classList.remove('hidden');
                coordWgsGroup.classList.add('flex');
            }
        }

        const pickWgsGroup = document.getElementById('pickWgsGroup');
        const pickUtmGroup = document.getElementById('pickUtmGroup');
        if (pickWgsGroup && pickUtmGroup) {
            if (isUtm) {
                pickWgsGroup.classList.remove('grid');
                pickWgsGroup.classList.add('hidden');
                pickUtmGroup.classList.remove('hidden');
                pickUtmGroup.classList.add('grid');
            } else {
                pickUtmGroup.classList.remove('grid');
                pickUtmGroup.classList.add('hidden');
                pickWgsGroup.classList.remove('hidden');
                pickWgsGroup.classList.add('grid');
            }
        }
        // Laravel also refreshed the feature properties card here; the viewer does not exist yet at
        // this point, so there is nothing to refresh.
    }

    // Coordinate display follows the source: WGS84 latitude/longitude.
    updateCoordinateDisplay(false);

    // The account menu is a React component driven by mapStore.userMenuOpen (src/components/map/user-dropdown-menu.tsx).

    const uploadForm = document.getElementById('uploadForm');
    const activeUploadsList = document.getElementById('activeUploadsList');

    // The upload modal (src/components/map/upload-modal.tsx) keeps its form in mapStore.uploadDraft.

    // Layer list. The search / month inputs write mapStore.layerFilters (debounced reload); the
    // refresh button bumps layersRefreshRequest; the loaded catalog is rendered from mapStore.layerCatalog.
    let filterTimer;
    watchStore(state => state.layerFilters, () => {
        clearTimeout(filterTimer);
        pageTimeouts.delete(filterTimer);
        filterTimer = later(fetchAllLayers, 400);
    });
    watchStore(state => state.layersRefreshRequest, () => {
        const allLayersListContainer = document.getElementById('allLayersList');
        if (allLayersListContainer) allLayersListContainer.innerHTML = '';
        fetchAllLayers();
    });
    watchStore(state => state.layerCatalog, renderLayerList);

    // Initialize Layers
    fetchAllLayers();

    function fetchRecentUploads() {
        const list = document.getElementById('recentUploadList');
        if (!list) return;

        // Ensure loading state if list is being initialized or refreshed from empty
        if (list.innerHTML.trim() === '' || list.querySelector('#recentUploadEmptyState')) {
            list.innerHTML = loadingSpinner({ id: 'recentUploadLoading', message: 'Loading recent uploads' });
        }

        fetch('/geodata/layers/recent-uploads')
            .then(res => res.json())
            .then(data => {
                if (disposed) return;
                if (data.success) {
                    if (data.jobs.length === 0) {
                        list.innerHTML = `
                            <div id="recentUploadEmptyState" class="map-empty">
                                ${iconSvg('history')}
                                <p class="map-empty-title">No recent uploads</p>
                                <p class="map-empty-text">Finished and failed conversions are listed here.</p>
                            </div>
                        `;
                        return;
                    }

                    list.innerHTML = data.jobs.map(renderJobItem).join('');
                }
            })
            .catch(err => {
                if (disposed) return;
                console.error('Error loading recent uploads:', err);
                list.innerHTML = `
                    <div class="map-empty">
                        ${iconSvg('circle-alert', { className: 'text-map-danger' })}
                        <p class="map-empty-title">Couldn't load recent uploads</p>
                        <p class="map-empty-text">Check your connection, then press Refresh.</p>
                    </div>
                `;
            });
    }

    // Full class strings (not interpolated) so Tailwind can see them.
    const jobTones = {
        done: { tile: 'bg-map-success/12 text-map-success', icon: 'circle-check', iconClass: 'text-base' },
        failed: { tile: 'bg-map-danger/12 text-map-danger', icon: 'circle-alert', iconClass: 'text-base' },
        running: { tile: 'bg-map-accent-soft text-map-accent-ink', icon: 'loader-circle', iconClass: 'animate-spin text-base' },
    };

    function renderJobItem(job) {
        const tone = jobTones[job.is_done ? 'done' : (job.is_failed ? 'failed' : 'running')];
        const typeIcon = job.layer_type === 'terrain' ? 'mountain' : 'shapes';
        const processing = (!job.is_done && !job.is_failed) ?
            '<span aria-hidden="true">&middot;</span><span class="font-semibold text-map-accent-ink animate-pulse">Processing</span>' : '';

        return `
            <div class="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-map-hover">
                <span class="flex size-8 shrink-0 items-center justify-center rounded-[0.625rem] ${tone.tile}" aria-hidden="true">
                    ${iconSvg(tone.icon, { className: tone.iconClass })}
                </span>
                <div class="min-w-0 flex-1">
                    <p class="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-map-ink">
                        ${iconSvg(typeIcon, { className: 'shrink-0 text-xs text-map-subtle' })}
                        <span class="truncate">${escapeHtml(job.layer_name)}</span>
                    </p>
                    <p class="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[0.6875rem] text-map-subtle">
                        <span>${escapeHtml(job.time_diff)}</span>
                        <span aria-hidden="true">&middot;</span>
                        <span>${escapeHtml(job.status_label)}</span>
                        ${processing}
                    </p>
                </div>
            </div>`;
    }

    function fetchAllLayers() {
        const filters = mapStore.getState().layerFilters;

        const list = document.getElementById('allLayersList');
        if (!list) return;

        if (list.innerHTML.trim() === '' || list.querySelector('#layersEmptyState') || list.querySelector('#layersErrorState')) {
            list.innerHTML = skeleton({ count: 4, id: 'layersLoading' });
        }

        const seq = ++layersRequestSeq;
        mapStore.setState(state => ({ layerCatalog: { ...state.layerCatalog, status: 'loading' } }));

        let url = '/geodata/layers/all';
        const params = new URLSearchParams();
        if (filters.search) params.append('search', filters.search);
        if (filters.monthYear) params.append('month_year', filters.monthYear);

        if (params.toString()) {
            url += '?' + params.toString();
        }
        fetch(url)
            .then(res => res.json())
            .then(data => {
                if (disposed || seq !== layersRequestSeq) return;
                if (data.success) {
                    mapStore.setState({ layerCatalog: { status: 'ready', categories: data.categories, filters } });
                }
            })
            .catch(err => {
                if (disposed || seq !== layersRequestSeq) return;
                console.error('Error loading layers:', err);
                mapStore.setState(state => ({ layerCatalog: { ...state.layerCatalog, status: 'error' } }));
            });
    }

    /** Renders mapStore.layerCatalog into #allLayersList (layer cards keep the hooks cesium-map.js uses). */
    function renderLayerList(catalog) {
        const list = document.getElementById('allLayersList');
        if (!list) return;

        if (catalog.status === 'error') {
            list.innerHTML = `
                <div id="layersErrorState" class="map-empty mt-1">
                    ${iconSvg('circle-alert', { className: 'text-map-danger' })}
                    <p class="map-empty-title">Couldn't load layers</p>
                    <p class="map-empty-text">Check your connection, then press the refresh button.</p>
                </div>
            `;
            return;
        }
        if (catalog.status !== 'ready') return;

        const { search: searchQuery, monthYear } = catalog.filters;
        const { session, activeTerrainId, visibleVectorIds, pendingLayerIds } = mapStore.getState();
        let filteredCats = JSON.parse(JSON.stringify(catalog.categories));

        if (searchQuery || monthYear) {
            filteredCats = filteredCats.map(cat => {
                cat.layers = cat.layers.filter(layer => {
                    let matches = true;
                    if (searchQuery) {
                        matches = matches && layer.name.toLowerCase().includes(searchQuery.toLowerCase());
                    }
                    if (monthYear) {
                        const acqDate = layer.layer_type === 'terrain' ?
                            (layer.terrain_detail?.acquisition_date || '') :
                            (layer.vector_detail?.acquisition_date || '');
                        const crDate = layer.created_at || '';
                        matches = matches && (matchMonthYear(acqDate, monthYear) || matchMonthYear(crDate, monthYear));
                    }
                    return matches;
                });
                return cat;
            }).filter(cat => cat.layers.length > 0);
        }

        if (filteredCats.length === 0) {
            const isFiltered = Boolean(searchQuery || monthYear);
            const emptyTitle = searchQuery ?
                'No layers match “' + escapeHtml(searchQuery) + '”' :
                (isFiltered ? 'No layers in this month' : 'No layers yet');
            const emptyText = isFiltered ?
                'Try another name or clear the month filter.' :
                (session.canUpload ? 'Upload terrain or vector data from the Data panel.' : 'Layers appear here once an admin uploads data.');
            list.innerHTML = `
                <div id="layersEmptyState" class="map-empty mt-1">
                    ${iconSvg(isFiltered ? 'search' : 'layers')}
                    <p class="map-empty-title">${emptyTitle}</p>
                    <p class="map-empty-text">${emptyText}</p>
                </div>
            `;
            return;
        }

        const html = filteredCats.map(cat => {
            const layersHtml = cat.layers.map(layer => {
                const layerIdStr = String(layer.id);
                let isActive = false;
                let dataAttrs = '';

                if (layer.layer_type === 'terrain') {
                    isActive = activeTerrainId === layerIdStr;
                    const bbox = JSON.stringify(layer.terrain_detail ? (layer.terrain_detail.native_bounding_box || {}) : {});
                    dataAttrs =
                        `data-id='${layer.id}' data-terrain-url='${layer.terrain_detail ? layer.terrain_detail.tileset_url : ''}' data-has-ortho='${layer.terrain_detail ? layer.terrain_detail.has_ortho : 'false'}' data-bbox='${bbox}' data-has-ortho-tiles='${layer.terrain_detail ? layer.terrain_detail.has_ortho_tiles : 'false'}' data-ortho-tiles-url='${layer.terrain_detail ? (layer.terrain_detail.ortho_tiles_url || '') : ''}' data-ortho-tiles-min-zoom='${layer.terrain_detail ? (layer.terrain_detail.ortho_min_zoom || 10) : 10}' data-ortho-tiles-max-zoom='${layer.terrain_detail ? (layer.terrain_detail.ortho_max_zoom || 18) : 18}'`;
                } else {
                    isActive = visibleVectorIds.includes(layerIdStr);
                    const bbox = JSON.stringify(layer.vector_detail ? (layer.vector_detail.native_bounding_box || {}) : {});
                    dataAttrs =
                        `data-id='${layer.id}' data-bbox='${bbox}' data-category-color='${safeColor(cat.color)}' data-category-icon-url='${escapeHtml(cat.icon_url || '')}' data-category-name='${escapeHtml(cat.name)}'`;
                }

                const acqDate = layer.layer_type === 'terrain' ?
                    (layer.terrain_detail?.acquisition_date || 'N/A') :
                    (layer.vector_detail?.acquisition_date || 'N/A');

                return layerCard({
                    id: layerIdStr,
                    name: layer.name,
                    acquisitionDate: acqDate,
                    createdAt: layer.created_at,
                    dataAttrs,
                    layerType: layer.layer_type,
                    isActive: Boolean(isActive),
                    isPending: pendingLayerIds.includes(layerIdStr),
                    categoryColor: safeColor(cat.color),
                });
            }).join('');

            return accordionGroupData({
                id: String(cat.id),
                title: cat.name,
                count: cat.layers.length,
                icon: groupDot(cat.color),
                content: layersHtml,
            });
        }).join('');

        list.innerHTML = `<div class="flex flex-col">${html}</div>`;

        document.dispatchEvent(new CustomEvent('vectorLayersRendered'));
    }

    // Runtime handles of the running uploads (AbortController, resume sessions, pause flag), used by
    // ./upload/*. Their visible state (card list, badge, leave warning) is mapStore.uploads.
    const uploadStates = new Map();

    /** Message shown before leaving the page while uploads are running (null when none). */
    function leaveWarning() {
        const statuses = mapStore.getState().uploads.map(upload => upload.status);
        if (statuses.includes('uploading')) return UPLOADING_MESSAGE;
        if (statuses.includes('processing')) return PROCESSING_MESSAGE;
        return null;
    }

    // Prevent closing page if uploads are in progress
    addPageEventListener(window, 'beforeunload', (e) => {
        const message = leaveWarning();
        if (message) {
            e.preventDefault();
            e.returnValue = message;
            return e.returnValue;
        }
    });

    // Client-side navigation (Next.js links) does not fire beforeunload: ask the same question.
    addPageEventListener(document, 'click', (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const link = e.target instanceof Element ? e.target.closest('a[href]') : null;
        if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
        const url = new URL(link.href, window.location.href);
        if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
        const message = leaveWarning();
        if (message && !window.confirm(message)) {
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    // Leaving the page (unmount) cancels running uploads like closing the tab did in Laravel. The
    // server-side sessions are kept, so the upload resumes when the same file is selected again.
    cleanupCallbacks.push(() => {
        uploadStates.forEach(state => {
            if (state.status === 'uploading') {
                state.cancelled = true;
                state.abortController?.abort();
            }
        });
        uploadStates.clear();
    });

    /** Same as pollJobStatus(), but not started once the page is gone. */
    function pollJobStatusWhileMounted(jobId, options) {
        if (disposed) return null;
        return pollJobStatus(jobId, options, activePollTimers);
    }

    /** Inserts a progress card into the Data panel and records the upload in the store. */
    function addUploadCard(uploadId, name, type) {
        activeUploadsList.insertAdjacentHTML('afterbegin', uploadProgressCard({ uploadId, fileName: name, type }));
        mapStore.getState().addUpload({ id: uploadId, name, type, status: 'uploading' });
        return document.getElementById(uploadId);
    }

    function removeUploadCard(uploadId, progressItem) {
        progressItem?.remove();
        mapStore.getState().removeUpload(uploadId);
    }

    const setUploadStatus = (uploadId, status) => mapStore.getState().updateUpload(uploadId, { status });

    // uploadFileInChunks, generateUploadId come from ./upload/chunked-upload.js
    if (uploadForm && activeUploadsList) addPageEventListener(uploadForm, 'submit', async (e) => {
        e.preventDefault();
        const draft = mapStore.getState().uploadDraft;

        if (draft.dataType === 'terrain') {
            if (!draft.demFile) return;

            // Capture values before the form is reset
            const uploadDemFile = draft.demFile;
            const uploadOrthoFile = draft.orthoFile;
            const finalLayerName = draft.layerName || uploadDemFile.name;
            const finalAcquisitionDate = draft.acquisitionDate;
            const layerCategoryId = draft.categoryId || null;

            closeModal('upload');
            mapStore.getState().resetUploadDraft();

            // Show the data panel (closes the layers panel, which shares its slot)
            mapStore.getState().showPanel('data');

            // Create progress item in activeUploadsList
            const uploadId = generateUploadId();
            const progressItem = addUploadCard(uploadId, finalLayerName, 'terrain');
            const progressLabel = progressItem.querySelector('.progress-label');
            const progressPercent = progressItem.querySelector('.progress-percent');
            const progressContainer = progressItem.querySelector('.progress-container');
            const progressBar = progressItem.querySelector('.progress-bar');

            try {
                const demResult = await uploadFileInChunks(uploadDemFile, (current, total) => {
                    const percent = Math.round((current / total) * 100);
                    progressLabel.textContent = `Uploading DEM (${uploadDemFile.name})...`;
                    progressPercent.textContent = `${percent}%`;
                    progressBar.style.width = `${percent}%`;
                }, uploadId, uploadStates, {
                    chunkUploadUrl: '/geodata/upload/chunk'
                });

                let orthoResult = null;
                if (uploadOrthoFile) {
                    progressLabel.textContent = `Uploading Orthophoto (${uploadOrthoFile.name})...`;
                    progressPercent.textContent = `0%`;
                    progressBar.style.width = `0%`;
                    orthoResult = await uploadFileInChunks(uploadOrthoFile, (current, total) => {
                        const percent = Math.round((current / total) * 100);
                        progressPercent.textContent = `${percent}%`;
                        progressBar.style.width = `${percent}%`;
                    }, uploadId, uploadStates, {
                        chunkUploadUrl: '/geodata/upload/chunk'
                    });
                }

                // Remove controls once uploading is done
                const controls = progressItem.querySelector('.upload-controls');
                if (controls) controls.remove();

                progressLabel.textContent = 'Assembling and verifying files...';
                progressPercent.textContent = '100%';
                progressBar.style.width = '100%';

                const assemblePayload = {
                    layerName: finalLayerName,
                    acquisitionDate: finalAcquisitionDate,
                    demIdentifier: demResult.identifier,
                    demFileName: demResult.fileName,
                    demTotalChunks: demResult.totalChunks,
                    orthoIdentifier: orthoResult ? orthoResult.identifier : null,
                    orthoFileName: orthoResult ? orthoResult.fileName : null,
                    orthoTotalChunks: orthoResult ? orthoResult.totalChunks : null,
                    layer_category_id: layerCategoryId
                };

                const assembleData = await submitGeodataUpload('/geodata/upload/assemble-raster', assemblePayload, uploadStates.get(uploadId));
                const jobId = assembleData.job_id;

                // Update upload state to processing
                const state = uploadStates.get(uploadId);
                if (state) {
                    state.status = 'processing';
                }
                setUploadStatus(uploadId, 'processing');

                // Start polling for status
                setProgressState(progressLabel, 'queued', 'Queued for processing.');
                progressPercent.style.display = 'none'; // Hide percent text
                progressContainer.style.display = 'none'; // Hide progress bar

                pollJobStatusWhileMounted(jobId, {
                    interval: CONFIG.POLL_INTERVAL.TERRAIN,
                    statusBaseUrl: '/geodata/upload/status/',
                    onProcessing: () => {
                        setProgressState(progressLabel, 'processing', 'Processing terrain tiles.');
                    },
                    onDone: () => {
                        setProgressState(progressLabel, 'success', 'Successfully Processed!');

                        uploadStates.delete(uploadId);
                        setUploadStatus(uploadId, 'done');
                        later(() => {
                            mapStore.getState().refreshRecentUploads();
                            fetchAllLayers();
                            progressItem.classList.add('opacity-0', 'transition-opacity', 'duration-500');
                            later(() => removeUploadCard(uploadId, progressItem), 500);
                        }, 1000);
                    },
                    onFail: (errorMessage) => {
                        uploadStates.delete(uploadId);
                        setUploadStatus(uploadId, 'failed');
                        setProgressState(progressLabel, 'error', 'Processing Failed: ' + errorMessage);
                    }
                });

            } catch (error) {
                if (disposed) return;
                console.error('Upload Error:', error);
                if (error.message !== 'CANCELLED') {
                    setProgressState(progressLabel, 'error', 'Upload Failed: ' + error.message);
                    progressPercent.style.display = 'none';
                    progressContainer.style.display = 'none';
                    markUploadFailed(uploadId, uploadStates, progressItem);
                    setUploadStatus(uploadId, 'failed');
                }
            }
        } else if (draft.dataType === 'vector') {
            if (!draft.file) return;

            const uploadFile = draft.file;
            const finalLayerName = draft.layerName || uploadFile.name;
            const sourceEpsg = draft.sourceEpsg;
            const finalAcquisitionDate = draft.acquisitionDate;
            const layerCategoryId = draft.categoryId || null;

            closeModal('upload');
            mapStore.getState().resetUploadDraft();

            // Show the data panel (closes the layers panel, which shares its slot)
            mapStore.getState().showPanel('data');

            const uploadId = generateUploadId();
            const progressItem = addUploadCard(uploadId, finalLayerName, 'vector');
            const progressLabel = progressItem.querySelector('.progress-label');
            const progressPercent = progressItem.querySelector('.progress-percent');
            const progressContainer = progressItem.querySelector('.progress-container');
            const progressBar = progressItem.querySelector('.progress-bar');

            try {
                const result = await uploadFileInChunks(uploadFile, (current, total) => {
                    const percent = Math.round((current / total) * 100);
                    progressPercent.textContent = `${percent}%`;
                    progressBar.style.width = `${percent}%`;
                }, uploadId, uploadStates, {
                    chunkUploadUrl: '/geodata/upload/chunk'
                });

                const controls = progressItem.querySelector('.upload-controls');
                if (controls) controls.remove();

                progressLabel.textContent = 'Assembling and importing...';
                progressPercent.textContent = '100%';
                progressBar.style.width = '100%';

                const assemblePayload = {
                    layerName: finalLayerName,
                    identifier: result.identifier,
                    fileName: result.fileName,
                    totalChunks: result.totalChunks,
                    sourceEpsg: sourceEpsg || null,
                    acquisitionDate: finalAcquisitionDate || null,
                    layer_category_id: layerCategoryId || null
                };

                const assembleData = await submitGeodataUpload('/geodata/upload/assemble-vector', assemblePayload, uploadStates.get(uploadId));
                const jobId = assembleData.job_id;

                // Update upload state to processing
                const state = uploadStates.get(uploadId);
                if (state) {
                    state.status = 'processing';
                }
                setUploadStatus(uploadId, 'processing');

                setProgressState(progressLabel, 'queued', 'Queued for processing.');
                progressPercent.style.display = 'none';
                progressContainer.style.display = 'none';

                pollJobStatusWhileMounted(jobId, {
                    interval: CONFIG.POLL_INTERVAL.VECTOR,
                    statusBaseUrl: '/geodata/upload/status/',
                    onProcessing: () => {
                        setProgressState(progressLabel, 'processing', 'Importing features to PostGIS.');
                    },
                    onDone: () => {
                        setProgressState(progressLabel, 'success', 'Successfully Imported!');

                        uploadStates.delete(uploadId);
                        setUploadStatus(uploadId, 'done');
                        later(() => {
                            fetchAllLayers();
                            mapStore.getState().refreshRecentUploads();
                            progressItem.classList.add('opacity-0', 'transition-opacity', 'duration-500');
                            later(() => removeUploadCard(uploadId, progressItem), 500);
                        }, 1000);
                    },
                    onFail: (errorMessage) => {
                        uploadStates.delete(uploadId);
                        setUploadStatus(uploadId, 'failed');
                        setProgressState(progressLabel, 'error', 'Failed: ' + errorMessage);
                    }
                });

            } catch (error) {
                if (disposed) return;
                if (error.message !== 'CANCELLED') {
                    setProgressState(progressLabel, 'error', 'Error: ' + error.message);
                    markUploadFailed(uploadId, uploadStates, progressItem);
                    setUploadStatus(uploadId, 'failed');
                }
            }
        }
    });

    // The picked-point copy button is a React component (src/components/map/client-controls.tsx).

    // Pause/Cancel/Dismiss delegation from ./upload/upload-wiring.js
    if (activeUploadsList) {
        cleanupCallbacks.push(wireUploadControls(activeUploadsList, uploadStates, {
            cancelBtnClass: 'cancel-upload-btn',
            onCancel: (uploadId, progressItem) => {
                uploadStates.delete(uploadId);
                removeUploadCard(uploadId, progressItem);
            },
            onDismiss: (uploadId) => mapStore.getState().removeUpload(uploadId),
        }));
    }

    return cleanupMapPage;
}
