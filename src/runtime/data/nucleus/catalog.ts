export const ATHENA_DATA_NUCLEUS_EVENTS = {
	delete: "data.delete",
	insert: "data.insert",
	update: "data.update",
	upsert: "data.upsert",
} as const;

export type AthenaDataNucleusEvent =
	(typeof ATHENA_DATA_NUCLEUS_EVENTS)[keyof typeof ATHENA_DATA_NUCLEUS_EVENTS];
