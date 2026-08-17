/**
 * Type-level fixture for P2: Preserve JsonValue inference in the recursive schema.
 * Checked via test/tsconfig.json-value-infer.json — not a runtime suite entry.
 */
import type { z } from "zod";
import type { JsonObject, JsonValue } from "../src/contracts/v1/common.ts";
import { parseContractOrThrow } from "../src/runtime/parse.ts";
import { jsonObjectSchema, jsonValueSchema } from "../src/runtime/schemas.ts";

/** Parse result must be assignable to JsonValue without a cast. */
const parsedValue = parseContractOrThrow(jsonValueSchema, {
	nested: [1, true, null, "x"],
});
const asJsonValue: JsonValue = parsedValue;

/** Parse result must be assignable to JsonObject without a cast. */
const parsedObject = parseContractOrThrow(jsonObjectSchema, {
	a: 1,
	b: [null, { c: "y" }],
});
const asJsonObject: JsonObject = parsedObject;

type InferValue = z.infer<typeof jsonValueSchema>;
type InferObject = z.infer<typeof jsonObjectSchema>;

/** z.infer output must be assignable into the public DTO types. */
const _valueFromInfer: JsonValue = null as unknown as InferValue;
const _objectFromInfer: JsonObject = null as unknown as InferObject;

void asJsonValue;
void asJsonObject;
void _valueFromInfer;
void _objectFromInfer;
