import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * Which record's dialog is open on a dashboard list page: the layer "detail" / "edit" modals, or the
 * create/edit "form" of categories and users (`row: null` creates). Row buttons and the header's
 * "New" button open it, the modals read and close it, so the table, header and modals share it
 * without passing state and callbacks through props.
 *
 * Closing keeps `row`, so the modal's content stays in place while it animates out. `session`
 * increases on every open; modals key their form with it, so each opening starts from fresh local
 * form state (field values and errors stay in the form's own useState).
 *
 * Mount one per page with createScopedStore() (src/stores/scoped-store.tsx).
 */
export type RecordDialogState<Kind extends string, Row> = {
  kind: Kind | null;
  row: Row | null;
  session: number;
  openDialog: (kind: Kind, row: Row | null) => void;
  closeDialog: () => void;
};

export function createRecordDialogStore<Kind extends string, Row>(): StoreApi<RecordDialogState<Kind, Row>> {
  return createStore<RecordDialogState<Kind, Row>>()((set) => ({
    kind: null,
    row: null,
    session: 0,
    openDialog: (kind, row) => set((state) => ({ kind, row, session: state.session + 1 })),
    closeDialog: () => set({ kind: null }),
  }));
}
