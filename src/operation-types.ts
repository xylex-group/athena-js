import type { AthenaGatewayMethod } from './gateway/types.ts'

export const AthenaDataOperation = {
  Select: 'select',
  Insert: 'insert',
  Upsert: 'upsert',
  Update: 'update',
  Delete: 'delete',
  Rpc: 'rpc',
  Query: 'query',
} as const

export type AthenaDataOperation =
  typeof AthenaDataOperation[keyof typeof AthenaDataOperation]

export const AthenaStorageOperation = {
  ListStorageCatalogs: 'listStorageCatalogs',
  CreateStorageCatalog: 'createStorageCatalog',
  UpdateStorageCatalog: 'updateStorageCatalog',
  DeleteStorageCatalog: 'deleteStorageCatalog',
  ListStorageCredentials: 'listStorageCredentials',
  CreateStorageUploadUrl: 'createStorageUploadUrl',
  CreateStorageUploadUrls: 'createStorageUploadUrls',
  ListStorageFiles: 'listStorageFiles',
  GetStorageFile: 'getStorageFile',
  GetStorageFileUrl: 'getStorageFileUrl',
  GetStorageFileProxy: 'getStorageFileProxy',
  UpdateStorageFile: 'updateStorageFile',
  DeleteStorageFile: 'deleteStorageFile',
  DeleteStorageFolder: 'deleteStorageFolder',
} as const

export type AthenaStorageOperation =
  typeof AthenaStorageOperation[keyof typeof AthenaStorageOperation]

export type AthenaStorageFallbackOperation = `storage:${Lowercase<AthenaGatewayMethod>}`

export const AthenaOperation = {
  ...AthenaDataOperation,
  ...AthenaStorageOperation,
} as const

export type AthenaKnownOperation =
  | typeof AthenaOperation[keyof typeof AthenaOperation]
  | AthenaStorageFallbackOperation

export type AthenaOperationName = AthenaKnownOperation | (string & {})
