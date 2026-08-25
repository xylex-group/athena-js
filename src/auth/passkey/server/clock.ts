/** Clock port. Adapters (system / test) land in later slices. */
export interface PasskeyClock {
  now(): Date;
}
