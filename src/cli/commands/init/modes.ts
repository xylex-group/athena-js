export const INIT_MODES = ["direct", "gateway", "auto"] as const;

export type InitMode = (typeof INIT_MODES)[number];
