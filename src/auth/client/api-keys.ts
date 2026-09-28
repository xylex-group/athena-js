import type {
  AthenaApiKeyDeleteAllExpiredResponse,
  InternalAthenaAuthModule,
} from "../types.ts";
import type { AuthTransport } from "./transport.ts";

export function createApiKeyClientModule(input: { transport: AuthTransport }) {
  const { transport } = input;
  const { resolvedConfig } = transport;

  const apiKey: InternalAthenaAuthModule["auth"]["apiKey"] = {
    create: (input, options) =>
      transport.postGeneric("/api-key/create", input, options),
    delete: (input, options) =>
      transport.postGeneric("/api-key/delete", input, options),
    deleteAllExpired: (input, options) =>
      transport.executePostWithOptionalInput<AthenaApiKeyDeleteAllExpiredResponse>(
        resolvedConfig,
        { endpoint: "/api-key/delete-all-expired-api-keys", method: "POST" },
        input,
        options
      ),
    get: (input, options) =>
      transport.getWithQuery("/api-key/get", input, options),
    list: (input, options) =>
      transport.getWithQuery("/api-key/list", input, options),
    update: (input, options) =>
      transport.postGeneric("/api-key/update", input, options),
    verify: (input, options) =>
      transport.postGeneric("/api-key/verify", input, options),
  };

  return { apiKey };
}
