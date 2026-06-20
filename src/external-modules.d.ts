declare module '@react-email/render' {
  export function render(element: unknown): string | Promise<string>
  export function toPlainText(html: string): string | Promise<string>
  export function pretty(html: string): string | Promise<string>
}

declare module 'next/headers' {
  export interface ReadonlyHeaders {
    get(name: string): string | null
  }

  export interface RequestCookie {
    name: string
    value: string
  }

  export interface ReadonlyRequestCookies {
    getAll(): RequestCookie[]
  }

  export function headers(): Promise<ReadonlyHeaders>
  export function cookies(): Promise<ReadonlyRequestCookies>
}
