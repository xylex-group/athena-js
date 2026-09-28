import { createLocalStorageModule } from "../../local.ts";
import type { AthenaStorageModule } from "../../module.ts";
import {
  mapProviderFailure,
  storageErrorResult,
  storageOkResult,
} from "../errors.ts";
import type {
  AuthorizedStorageOperation,
  StorageObjectProvider,
} from "../types.ts";

export function createLocalStorageProvider(
  store: AthenaStorageModule
): StorageObjectProvider {
  return {
    async execute(op: AuthorizedStorageOperation) {
      try {
        switch (op.op) {
          case "put": {
            if (!op.key?.trim()) {
              return storageErrorResult({
                message: "put requires key",
                source: "runtime",
                status: 400,
              });
            }
            const data = await store.file.upload({
              body: op.body ?? new Uint8Array(),
              name: op.key,
              source: op.body ?? new Uint8Array(),
              storage_key: op.key,
            } as never);
            return storageOkResult(data);
          }
          case "get": {
            if (!op.key?.trim()) {
              return storageErrorResult({
                message: "get requires key",
                source: "runtime",
                status: 400,
              });
            }
            const data = await store.file.get({ storage_key: op.key } as never);
            return storageOkResult(data);
          }
          case "head": {
            if (!op.key?.trim()) {
              return storageErrorResult({
                message: "head requires key",
                source: "runtime",
                status: 400,
              });
            }
            const data = await (
              store.file as typeof store.file & {
                head: (input: never) => Promise<unknown>;
              }
            ).head({ storage_key: op.key } as never);
            return storageOkResult(data);
          }
          case "delete": {
            if (!op.key?.trim()) {
              return storageErrorResult({
                message: "delete requires key",
                source: "runtime",
                status: 400,
              });
            }
            const data = await store.file.delete({
              storage_key: op.key,
            } as never);
            return storageOkResult(data);
          }
          case "list": {
            const data = await store.file.list({
              cursor: op.cursor,
              limit: op.limit,
              prefix: op.prefix,
            } as never);
            return storageOkResult(data);
          }
          default:
            return storageErrorResult({
              message: `unsupported op ${String(op.op)}`,
              source: "runtime",
              status: 400,
            });
        }
      } catch (error) {
        return mapProviderFailure(error);
      }
    },
  };
}

export function createLocalStorageProviderFromRoot(options: {
  prefix?: string | null;
  root: string;
}): StorageObjectProvider {
  return createLocalStorageProvider(
    createLocalStorageModule({
      prefix: options.prefix,
      root: options.root,
    })
  );
}
