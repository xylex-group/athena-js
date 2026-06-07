export { slugify } from './slugify.ts'
export { trimTrailingSlashes } from './trim-trailing-slashes.ts'
export {
  asString,
  asBoolean,
  asBooleanOrNull,
  asRecord,
  asIdentifier,
  firstString,
  readTrimmedString,
  asNumber,
  asStringArray,
} from './coercions.ts'
export { parseBooleanFlag } from './parse-boolean-flag.ts'
export { isLocalHostname } from './hostname.ts'
export { clearAuthCookies } from './auth-cookies.ts'
export { proxyRequestHeaders } from './proxy-request-headers.ts'
export {
  sqlText,
  escapeLikePatternValue,
  quoteSqlStringLiteral,
  sqlNullableText,
  sqlJsonbLiteral,
  sqlBigInt,
} from './sql-literals.ts'

export type { ClearAuthCookiesOptions } from './auth-cookies.ts'
