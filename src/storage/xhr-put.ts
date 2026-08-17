/**
 * Shared XHR PUT helper for browser uploads (presigned + direct SigV4).
 * Keeps progress/abort/status handling consistent across file and direct-upload.
 */

export type AthenaStorageXhrPutBody =
  | Blob
  | ArrayBuffer
  | ArrayBufferView
  | ReadableStream<Uint8Array>
  | null
  | undefined;

export interface AthenaStorageXhrPutOptions {
  body: AthenaStorageXhrPutBody;
  /** Final progress loaded value on success (defaults to 0 when unknown). */
  completeLoaded?: number;
  headers: Headers | Record<string, string>;
  onProgress: (progress: { loaded: number }) => void;
  /** Error message prefix for status/network failures. */
  operationLabel?: string;
  signal?: AbortSignal;
  url: string;
}

interface AthenaStorageXhrLike {
  abort: () => void;
  getAllResponseHeaders: () => string;
  onabort: (() => void) | null;
  onerror: (() => void) | null;
  onload: (() => void) | null;
  open: (method: string, url: string) => void;
  readonly response: unknown;
  send: (body: unknown) => void;
  setRequestHeader: (key: string, value: string) => void;
  readonly status: number;
  readonly statusText: string;
  readonly upload: {
    onprogress: ((event: { loaded: number }) => void) | null;
  };
}

declare const XMLHttpRequest: (new () => AthenaStorageXhrLike) | undefined;

/**
 * True when the runtime exposes XMLHttpRequest (browsers).
 */
export function canUseStorageXhrPut(): boolean {
  return typeof XMLHttpRequest !== "undefined";
}

/**
 * PUT `body` to `url` with XHR so `upload.onprogress` works.
 * Rejects with AbortError on abort; network/status errors include `operationLabel`.
 */
export function putStorageBodyWithXhr(
  options: AthenaStorageXhrPutOptions
): Promise<Response> {
  const label = options.operationLabel ?? "athena.storage.file.upload";
  const Xhr = XMLHttpRequest;
  if (Xhr === undefined) {
    return Promise.reject(
      new Error(`${label} requires XMLHttpRequest in this runtime`)
    );
  }

  return new Promise((resolve, reject) => {
    const xhr = new Xhr();
    const abort = () => xhr.abort();
    xhr.open("PUT", options.url);
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => {
        xhr.setRequestHeader(key, value);
      });
    } else {
      for (const [key, value] of Object.entries(options.headers)) {
        xhr.setRequestHeader(key, value);
      }
    }
    xhr.upload.onprogress = (event) => {
      options.onProgress({ loaded: event.loaded });
    };
    xhr.onload = () => {
      options.signal?.removeEventListener("abort", abort);
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`${label} failed with status ${xhr.status}`));
        return;
      }
      options.onProgress({
        loaded: options.completeLoaded ?? 0,
      });
      resolve(
        new Response(
          xhr.response as ConstructorParameters<typeof Response>[0],
          {
            headers: parseXhrHeaders(xhr.getAllResponseHeaders()),
            status: xhr.status,
            statusText: xhr.statusText,
          }
        )
      );
    };
    xhr.onerror = () => {
      options.signal?.removeEventListener("abort", abort);
      reject(new Error(`${label} failed with a network error`));
    };
    xhr.onabort = () => {
      options.signal?.removeEventListener("abort", abort);
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    if (options.signal) {
      if (options.signal.aborted) {
        abort();
        return;
      }
      options.signal.addEventListener("abort", abort, { once: true });
    }
    xhr.send(options.body);
  });
}

/**
 * Parse `XMLHttpRequest#getAllResponseHeaders()` into a Headers object.
 */
export function parseXhrHeaders(rawHeaders: string): Headers {
  const headers = new Headers();
  for (const line of rawHeaders.trim().split(/[\r\n]+/)) {
    const index = line.indexOf(":");
    if (index === -1) {
      continue;
    }
    headers.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  return headers;
}
