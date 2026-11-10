import { createContext, use, useState, type ReactNode } from "react";
import { useStore, type StoreApi } from "zustand";

/**
 * Binds a vanilla zustand store to a component subtree (zustand's recommended setup for Next.js):
 * each mounted <Provider> creates its own store, so page state starts over when the page is left and
 * revisited, and no state is shared between requests while rendering on the server.
 *
 * For client components only. Returns `[Provider, useScopedStore]`; the hook takes a selector, as
 * zustand's bound `useStore` hooks do.
 */
export function createScopedStore<State>(name: string, init: () => StoreApi<State>) {
  const StoreContext = createContext<StoreApi<State> | null>(null);

  function Provider({ children }: { children: ReactNode }) {
    const [store] = useState(init);
    return <StoreContext value={store}>{children}</StoreContext>;
  }
  Provider.displayName = `${name}Provider`;

  function useScopedStore<T>(selector: (state: State) => T): T {
    const store = use(StoreContext);
    if (!store) throw new Error(`${name} is used outside of its provider.`);
    return useStore(store, selector);
  }

  return [Provider, useScopedStore] as const;
}
