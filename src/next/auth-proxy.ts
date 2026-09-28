/**
 * Compat re-export. Implementation lives in `auth/http/proxy.ts`
 * so Web handlers are not a Next adapter concern.
 */
export {
  type AthenaAuthProxyFromClientOptions,
  type AthenaAuthProxyHandlersOptions,
  type AthenaAuthProxyOptions,
  type AthenaAuthProxyTransportOptions,
  athenaAuthHandlers,
  createAthenaAuthHandlers,
  createAthenaAuthProxyHandlers,
  decodeCookieValue,
  proxyAthenaAuthRequest,
  readCookieValue,
  readCookieValueFromRequest,
  resolveAthenaAuthProxyUpstreamBaseUrl,
} from "../auth/http/proxy.ts";
