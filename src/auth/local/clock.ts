export interface AuthClock {
  now(): Date;
}

export const systemAuthClock: AuthClock = {
  now: () => new Date(),
};
