import { afterEach, describe, expect, it } from "vitest";

import { createRecordDialogStore } from "@/stores/record-dialog-store";
import { useUiStore } from "@/stores/ui-store";

describe("ui store (dashboard sidebar)", () => {
  afterEach(() => useUiStore.setState(useUiStore.getInitialState()));

  it("starts closed and opens / closes", () => {
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    useUiStore.getState().openSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    useUiStore.getState().closeSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });

  it("keeps the server snapshot closed whatever the client state", () => {
    useUiStore.getState().openSidebar();
    expect(useUiStore.getInitialState().sidebarOpen).toBe(false);
  });
});

describe("record dialog store", () => {
  type Row = { id: string };

  it("opens a dialog for a row and starts a new session each time", () => {
    const store = createRecordDialogStore<"detail" | "edit", Row>();
    expect(store.getState()).toMatchObject({ kind: null, row: null, session: 0 });

    store.getState().openDialog("detail", { id: "a" });
    expect(store.getState()).toMatchObject({ kind: "detail", row: { id: "a" }, session: 1 });

    store.getState().openDialog("edit", { id: "a" });
    expect(store.getState()).toMatchObject({ kind: "edit", row: { id: "a" }, session: 2 });
  });

  it("keeps the row after closing (the modal animates out with its content)", () => {
    const store = createRecordDialogStore<"form", Row>();
    store.getState().openDialog("form", { id: "b" });
    store.getState().closeDialog();
    expect(store.getState()).toMatchObject({ kind: null, row: { id: "b" }, session: 1 });
  });

  it("opens the create form with no row", () => {
    const store = createRecordDialogStore<"form", Row>();
    store.getState().openDialog("form", null);
    expect(store.getState()).toMatchObject({ kind: "form", row: null });
  });

  it("gives every store its own state", () => {
    const first = createRecordDialogStore<"form", Row>();
    const second = createRecordDialogStore<"form", Row>();
    first.getState().openDialog("form", { id: "c" });
    expect(second.getState().kind).toBeNull();
  });
});
