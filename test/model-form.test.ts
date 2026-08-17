import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
	createModelFormAdapter,
	defineModel,
	toModelFormDefaults,
	toModelPayload,
} from "../src/index.ts";

interface ProfileRow {
	active: boolean;
	age: number | null;
	display_name: string | null;
	id: string;
}

const profileModel = defineModel<ProfileRow>({
	meta: {
		database: "app",
		model: "profiles",
		nullable: {
			active: false,
			age: true,
			display_name: true,
			id: false,
		},
		primaryKey: ["id"],
		schema: "public",
	},
});

test("toModelFormDefaults converts nullable null fields to empty strings by default", () => {
	const defaults = toModelFormDefaults(profileModel, {
		active: true,
		age: null,
		display_name: null,
		id: "p_1",
	});

	assert.deepEqual(defaults, {
		active: true,
		age: "",
		display_name: "",
		id: "p_1",
	});
});

test("toModelFormDefaults supports undefined and null nullish modes", () => {
	const undefinedDefaults = toModelFormDefaults(
		profileModel,
		{ active: true, age: null, display_name: null, id: "p_1" },
		{ nullishMode: "undefined" },
	);
	assert.equal(undefinedDefaults.display_name, undefined);
	assert.equal(undefinedDefaults.age, undefined);

	const nullDefaults = toModelFormDefaults(
		profileModel,
		{ active: true, age: null, display_name: null, id: "p_1" },
		{ nullishMode: "null" },
	);
	assert.equal(nullDefaults.display_name, null);
	assert.equal(nullDefaults.age, null);
});

test("toModelPayload converts empty strings back to null for nullable columns", () => {
	const payload = toModelPayload(profileModel, {
		active: true,
		age: "",
		display_name: "",
		id: "p_1",
	});

	assert.deepEqual(payload, {
		active: true,
		age: null,
		display_name: null,
		id: "p_1",
	});
});

test("toModelPayload strips undefined keys by default and can preserve them", () => {
	const stripped = toModelPayload(profileModel, {
		age: undefined,
		display_name: "Ada",
		id: "p_1",
	});

	assert.deepEqual(stripped, {
		display_name: "Ada",
		id: "p_1",
	});

	const preserved = toModelPayload(
		profileModel,
		{
			age: undefined,
			display_name: "Ada",
			id: "p_1",
		},
		{ stripUndefined: false },
	);

	assert.equal("age" in preserved, true);
	assert.equal(preserved.age, undefined);
});

test("createModelFormAdapter exposes reusable defaults/insert/update helpers", () => {
	const adapter = createModelFormAdapter(profileModel);
	const defaults = adapter.toDefaults({ age: null, display_name: null });
	const insertPayload = adapter.toInsert({
		active: true,
		age: "",
		display_name: "",
		id: "p_1",
	});
	const updatePayload = adapter.toUpdate({ age: "", display_name: "" });

	assert.equal(defaults.display_name, "");
	assert.equal(defaults.age, "");
	assert.deepEqual(insertPayload, {
		active: true,
		age: null,
		display_name: null,
		id: "p_1",
	});
	assert.deepEqual(updatePayload, {
		age: null,
		display_name: null,
	});
});
