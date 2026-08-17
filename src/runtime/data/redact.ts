const REDACTED = "[redacted]";

const SECRET_PATTERNS: readonly RegExp[] = [
  /postgres(?:ql)?:\/\/[^\s"'\\]+/gi,
  /mongodb(?:\+srv)?:\/\/[^\s"'\\]+/gi,
  /mysql:\/\/[^\s"'\\]+/gi,
  /\b(?:password|passwd|secret|api[_-]?key|token|cookie)\s*[:=]\s*[^\s&"'\\]+/gi,
  /\bBearer\s+[A-Za-z0-9._\-+=/]+/gi,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
  /athena-auth[^=\s]*=[^;\s]+/gi,
  /better-auth[^=\s]*=[^;\s]+/gi,
];

const DRIVER_LEAK =
  /\b(?:ECONNREFUSED|ECONNRESET|password authentication failed|relation ".+" does not exist|syntax error at|node_modules|\\|\/home\/|\/Users\/|C:\\)/i;

export function redactSensitiveText(value: string): string {
  let out = value;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

export function isDriverOrFilesystemLeak(value: string): boolean {
  return DRIVER_LEAK.test(value);
}

export function publicRuntimeErrorMessage(value: string): string {
  if (
    isDriverOrFilesystemLeak(value) ||
    /postgres(?:ql)?:\/\//i.test(value) ||
    /\bBearer\s+/i.test(value) ||
    /\beyJ[A-Za-z0-9_-]+\./.test(value)
  ) {
    return "Athena Local Runtime request failed.";
  }
  return redactSensitiveText(value);
}
