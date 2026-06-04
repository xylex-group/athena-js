declare module '@react-email/render' {
  export function render(element: unknown): string | Promise<string>
  export function toPlainText(html: string): string | Promise<string>
  export function pretty(html: string): string | Promise<string>
}
