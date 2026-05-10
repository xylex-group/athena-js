import {
  attachStateAdapter,
  type AthenaQueryClient,
  type AthenaQueryEvent,
  type AthenaRuntimeEvent,
} from '@xylex-group/athena/react'

type ZustandLikeStore = {
  set: (
    updater: (state: {
      querySnapshots: Record<string, unknown>
      events: AthenaRuntimeEvent[]
    }) => {
      querySnapshots: Record<string, unknown>
      events: AthenaRuntimeEvent[]
    },
  ) => void
}

type ReduxLikeStore = {
  dispatch: (action: { type: string; payload: unknown }) => void
}

export function attachZustandLikeAdapter(
  client: AthenaQueryClient,
  store: ZustandLikeStore,
) {
  return attachStateAdapter(client, {
    onQueryUpdated(event: AthenaQueryEvent) {
      store.set(state => ({
        querySnapshots: {
          ...state.querySnapshots,
          [event.key]: event.state,
        },
        events: [...state.events, event],
      }))
    },
    onEvent(event) {
      if (event.type === 'mutation_updated' || event.type === 'mutation_reset') {
        store.set(state => ({
          querySnapshots: state.querySnapshots,
          events: [...state.events, event],
        }))
      }
    },
  })
}

export function attachReduxLikeAdapter(
  client: AthenaQueryClient,
  store: ReduxLikeStore,
) {
  return attachStateAdapter(client, {
    onEvent(event) {
      store.dispatch({
        type: `athena/runtime/${event.type}`,
        payload: event,
      })
    },
  })
}
