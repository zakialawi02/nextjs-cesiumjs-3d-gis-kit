import { CloudUpload } from "lucide-react";

import { loadingSpinner } from "@/lib/map/templates";

import {
  ActiveUploadsEmpty,
  PanelCloseButton,
  RecentUploadsRefreshButton,
  SidePanel,
} from "../client-controls";

/** Data panel (admins): upload entry point, in-flight uploads and recent conversions. */
export function DataPanel() {
  return (
    <SidePanel panel="data" labelledBy="dataPanelTitle">
      <span className="map-sheet-grabber" aria-hidden="true"></span>

      <header className="map-panel-head">
        <div className="min-w-0 flex-1">
          <h2 id="dataPanelTitle" className="map-panel-title">
            Data
          </h2>
          <p className="map-panel-sub">Upload elevation models, orthophotos and vector files.</p>
        </div>
        <PanelCloseButton id="closeDataBtn" label="Close data panel" />
      </header>

      <div className="flex-none px-3 pb-3">
        <button
          type="button"
          id="openUploadModalBtn"
          className="map-btn map-btn-primary w-full"
          data-modal-open="upload"
        >
          <CloudUpload size="1em" aria-hidden="true" />
          <span>Upload data</span>
        </button>
      </div>

      <div className="map-panel-body flex flex-col gap-5">
        <section id="activeUploadsSection" aria-labelledby="activeUploadsTitle">
          <h3 id="activeUploadsTitle" className="map-label mb-2">
            In progress
          </h3>
          {/* Progress cards are inserted by src/lib/map/map-page.js (and listed in mapStore.uploads). */}
          <div id="activeUploadsList" className="flex flex-col gap-2"></div>

          <ActiveUploadsEmpty>
            <CloudUpload size="1em" aria-hidden="true" />
            <p className="map-empty-title">No uploads in progress</p>
            <p className="map-empty-text">
              Uploads and conversions appear here until the layer is ready.
            </p>
          </ActiveUploadsEmpty>
        </section>

        <section aria-labelledby="recentUploadsTitle">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 id="recentUploadsTitle" className="map-label">
              Recent uploads
            </h3>
            <RecentUploadsRefreshButton />
          </div>
          {/* Filled from /geodata/layers/recent-uploads by src/lib/map/map-page.js (innerHTML). */}
          <div
            id="recentUploadList"
            className="flex flex-col gap-1.5"
            dangerouslySetInnerHTML={{
              __html: loadingSpinner({
                id: "recentUploadLoading",
                message: "Loading recent uploads",
              }),
            }}
          />
        </section>
      </div>
    </SidePanel>
  );
}
