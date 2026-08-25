export function formatEmailMailbox(from: string, fromName?: string): string {
  if (!fromName) {
    return from;
  }
  return `${fromName.replaceAll(/[\r\n<>]/g, "")} <${from}>`;
}

export function toBase64(content: string | Uint8Array): string {
  if (typeof content === "string") {
    return encodeUtf8Base64(content);
  }
  return encodeBytesBase64(content);
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  return encodeBytesBase64(bytes);
}

function encodeBytesBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    const slice = bytes.subarray(index, index + chunk);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}
