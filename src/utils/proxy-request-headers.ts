export function proxyRequestHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  const requestUrl = new URL(request.url);
  const proto = requestUrl.protocol.replace(/:$/u, "") || "https";

  // Let fetch set the upstream Host header, but keep the original public app
  // origin available for auth servers that need to validate or generate links
  // for Vercel preview domains behind this proxy.
  headers.delete("host");
  headers.set("x-forwarded-host", requestUrl.host);
  headers.set("x-forwarded-proto", proto);
  headers.set("x-forwarded-origin", requestUrl.origin);
  headers.set("x-forwarded-uri", `${requestUrl.pathname}${requestUrl.search}`);

  if (requestUrl.port) {
    headers.set("x-forwarded-port", requestUrl.port);
  } else {
    headers.delete("x-forwarded-port");
  }

  return headers;
}
