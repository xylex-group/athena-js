import {
  type AthenaQueryClient,
  type AthenaQueryEvent,
  type AthenaRuntimeEvent,
  attachStateAdapter,
} from "@xylex-group/athena/react";

interface ZustandLikeStore {
  set: (
    updater: (state: {
      querySnapshots: Record<string, unknown>;
      events: AthenaRuntimeEvent[];
    }) => {
      querySnapshots: Record<string, unknown>;
      events: AthenaRuntimeEvent[];
    }
  ) => void;
}

interface ReduxLikeStore {
  dispatch: (action: { type: string; payload: unknown }) => void;
}

export function attachZustandLikeAdapter(
  client: AthenaQueryClient,
  store: ZustandLikeStore
) {
  return attachStateAdapter(client, {
    onEvent(event) {
      if (
        event.type === "mutation_updated" ||
        event.type === "mutation_reset"
      ) {
        store.set((state) => ({
          events: [...state.events, event],
          querySnapshots: state.querySnapshots,
        }));
      }
    },
    onQueryUpdated(event: AthenaQueryEvent) {
      store.set((state) => ({
        events: [...state.events, event],
        querySnapshots: {
          ...state.querySnapshots,
          [event.key]: event.state,
        },
      }));
    },
  });
}

export function attachReduxLikeAdapter(
  client: AthenaQueryClient,
  store: ReduxLikeStore
) {
  return attachStateAdapter(client, {
    onEvent(event) {
      store.dispatch({
        payload: event,
        type: `athena/runtime/${event.type}`,
      });
    },
  });
}
