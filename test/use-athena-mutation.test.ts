import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import type { ReactTestRenderer } from "react-test-renderer";
import { act, create } from "react-test-renderer";
import { createClient, string, table } from "../src/index.ts";
import { compileAthenaQueryDescriptor } from "../src/query/descriptor.ts";
import { createAthenaEntityKey } from "../src/query/model-identity.ts";
import {
	AthenaQueryClientProvider,
	createAthenaQueryClient,
	type UseMutationResult,
	useAthenaMutation,
} from "../src/react/index.ts";
import type { AthenaQueryClientProviderProps } from "../src/react/provider.ts";

interface FileMutationInput {
	displayName: string;
	fileId: string;
}

function withQueryClientProvider(
	client: NonNullable<AthenaQueryClientProviderProps["client"]>,
	child: ReturnType<typeof createElement>,
) {
	return createElement(
		AthenaQueryClientProvider,
		{ client } as AthenaQueryClientProviderProps,
		child,
	);
}

const File = table("File")
	.schema("public")
	.from("files")
	.columns({
		displayName: string(),
		fileId: string().generated(),
		organizationId: string(),
	})
	.primaryKey("fileId");

function MutationProbe<TVariables, TData>(props: {
	hook: () => UseMutationResult<TVariables, TData>;
	onChange: (value: UseMutationResult<TVariables, TData>) => void;
}) {
	props.onChange(props.hook());
	return null;
}

test("useAthenaMutation reconciles the entity graph from the mutation descriptor", async () => {
	const original = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response(
			JSON.stringify({
				data: {
					displayName: "New.pdf",
					fileId: "1",
					organizationId: "org-a",
				},
			}),
			{ status: 200 },
		);

	const queryClient = createAthenaQueryClient();
	const list = compileAthenaQueryDescriptor({
		conditions: [{ column: "organizationId", operator: "eq", value: "org-a" }],
		context: { organizationId: "org-a" },
		model: File,
		operation: "select",
		projection: "*",
		tableName: "public.files",
	});
	await queryClient.executeQuery({
		descriptor: list,
		force: true,
		model: File,
		queryFn: async () => ({
			data: [
				{
					displayName: "Old.pdf",
					fileId: "1",
					organizationId: "org-a",
				},
			],
		}),
		queryKey: list.queryKey,
		queryKeyToken: queryClient.getQueryKeyToken(list.queryKey),
	});

	const athena = createClient({
		db: { url: "https://athena-db.com" },
		key: "secret",
	}).withContext({ organizationId: "org-a" });

	let latest: UseMutationResult<FileMutationInput, unknown> | undefined;
	let renderer: ReactTestRenderer | undefined;

	try {
		await act(async () => {
			renderer = create(
				withQueryClientProvider(
					queryClient,
					createElement(MutationProbe<FileMutationInput, unknown>, {
						hook: () =>
							useAthenaMutation((input: FileMutationInput) =>
								athena
									.from(File)
									.update({ displayName: input.displayName })
									.eq("fileId", input.fileId),
							),
						onChange: (value) => {
							latest = value;
						},
					}),
				),
			);
		});

		await act(async () => {
			await latest?.mutateAsync({ displayName: "New.pdf", fileId: "1" });
		});

		assert.equal(
			queryClient.getEntity(
				createAthenaEntityKey(
					File,
					{ fileId: "1" },
					{ organizationId: "org-a" },
				),
			)?.displayName,
			"New.pdf",
		);
		assert.equal(
			queryClient.getQueryData<{ data: Array<{ displayName: string }> }>(
				list.queryKey,
			)?.data[0]?.displayName,
			"New.pdf",
		);
	} finally {
		globalThis.fetch = original;
		renderer?.unmount();
	}
});
