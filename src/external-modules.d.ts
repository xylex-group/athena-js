declare module "@react-email/render" {
  export function render(element: unknown): string | Promise<string>;
  export function toPlainText(html: string): string | Promise<string>;
  export function pretty(html: string): string | Promise<string>;
}

declare module "@clack/prompts" {
  export function intro(message: string): void;
  export function outro(message: string): void;
  export function confirm(options: {
    message: string;
    initialValue?: boolean;
  }): Promise<boolean | symbol>;
  export function isCancel(value: unknown): boolean;
  export function spinner(): {
    start: (message?: string) => void;
    stop: (message?: string) => void;
  };
}

declare module "next/headers" {
  export interface ReadonlyHeaders {
    get: (name: string) => string | null;
  }

  export interface RequestCookie {
    name: string;
    value: string;
  }

  export interface ReadonlyRequestCookies {
    getAll: () => RequestCookie[];
  }

  export function headers(): Promise<ReadonlyHeaders>;
  export function cookies(): Promise<ReadonlyRequestCookies>;
}
