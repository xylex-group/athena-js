#!/usr/bin/env node
/**
 * Ephemeral PostgreSQL for test:finality.
 *
 * Resolution order (never skip):
 * 1. ATHENA_TEST_DATABASE_URL if it is a postgres(ql):// URI
 * 2. DATABASE_URL if it is a postgres(ql):// URI
 * 3. auto-launch ephemeral Postgres via docker or podman
 *
 * Missing URL + missing docker/podman is fail-closed (process.exit(1)).
 * Local container or provided URI only.
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..", "..");
const statePath = join(pkgRoot, ".tmp", "finality-state.json");
const IMAGE = "postgres:16-alpine";
const USER = "postgres";
const PASSWORD = "postgres";
const DB = "athena_finality";

function isPostgresUri(value) {
	return typeof value === "string" && /^postgres(ql)?:\/\//i.test(value.trim());
}

function resolveProvidedUrl() {
	const preferred = process.env.ATHENA_TEST_DATABASE_URL;
	if (isPostgresUri(preferred)) {
		return preferred.trim();
	}
	const fallback = process.env.DATABASE_URL;
	if (isPostgresUri(fallback)) {
		return fallback.trim();
	}
	return undefined;
}

function resolveBin(name) {
	return process.platform === "win32" ? `${name}.exe` : name;
}

function hasEngine(name) {
	const result = spawnSync(resolveBin(name), ["--version"], {
		encoding: "utf8",
		shell: process.platform === "win32",
	});
	return result.status === 0;
}

function engineArgs(engine, args) {
	return spawnSync(resolveBin(engine), args, {
		encoding: "utf8",
		shell: process.platform === "win32",
	});
}

function freePort() {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			server.close((error) => {
				if (error) {
					reject(error);
					return;
				}
				resolve(port);
			});
		});
		server.on("error", reject);
	});
}

function writeState(state) {
	mkdirSync(dirname(statePath), { recursive: true });
	writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function connectOnce(url) {
	const pg = await import("pg");
	const Client = pg.default?.Client ?? pg.Client;
	const client = new Client({
		connectionString: url,
		connectionTimeoutMillis: 3_000,
	});
	try {
		await client.connect();
		await client.query("SELECT 1");
	} finally {
		await client.end().catch(() => undefined);
	}
}

async function waitReady(engine, containerName, url) {
	const deadline = Date.now() + 90_000;
	let lastError = "pg_isready not ready";
	while (Date.now() < deadline) {
		const probe = engineArgs(engine, [
			"exec",
			containerName,
			"pg_isready",
			"-U",
			USER,
			"-d",
			DB,
		]);
		if (probe.status === 0) {
			try {
				// Initdb starts a temporary server, then shuts it down. Host
				// handshake must survive that restart.
				await connectOnce(url);
				return;
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
			}
		}
		await delay(500);
	}
	throw new Error(
		`ephemeral Postgres not ready (${engine} ${containerName}): ${lastError}`,
	);
}

async function allocateFreshDatabase(url) {
	const pg = await import("pg");
	const Client = pg.default?.Client ?? pg.Client;
	const client = new Client({
		connectionString: url,
		connectionTimeoutMillis: 10_000,
	});
	await client.connect();
	const schema = `finality_${process.pid}`;
	try {
		await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
		await client.query(`SET search_path TO ${schema}, public`);
	} finally {
		await client.end();
	}
	const separator = url.includes("?") ? "&" : "?";
	return `${url}${separator}options=${encodeURIComponent(`-csearch_path=${schema}`)}`;
}

async function autoLaunch() {
	const docker = hasEngine("docker");
	const podman = hasEngine("podman");
	if (!(docker || podman)) {
		console.error(
			"fail-closed: neither ATHENA_TEST_DATABASE_URL nor DATABASE_URL is set, and neither docker nor podman can launch Postgres",
		);
		process.exit(1);
	}
	const engine = docker ? "docker" : "podman";
	const port = await freePort();
	const containerName = `athena-js-finality-${process.pid}`;
	engineArgs(engine, ["rm", "-f", containerName]);
	const run = engineArgs(engine, [
		"run",
		"-d",
		"--name",
		containerName,
		"-e",
		`POSTGRES_USER=${USER}`,
		"-e",
		`POSTGRES_PASSWORD=${PASSWORD}`,
		"-e",
		`POSTGRES_DB=${DB}`,
		"-p",
		`127.0.0.1:${port}:5432`,
		IMAGE,
	]);
	if (run.status !== 0) {
		console.error(run.stderr || run.stdout || `failed to launch ${engine}`);
		process.exit(1);
	}
	const url = `postgresql://${USER}:${PASSWORD}@127.0.0.1:${port}/${DB}`;
	try {
		await waitReady(engine, containerName, url);
		const allocated = await allocateFreshDatabase(url);
		writeState({
			containerName,
			engine,
			ephemeral: true,
			port,
			url: allocated,
		});
		return allocated;
	} catch (error) {
		engineArgs(engine, ["rm", "-f", containerName]);
		throw error;
	}
}

async function up() {
	const provided = resolveProvidedUrl();
	if (provided) {
		const allocated = await allocateFreshDatabase(provided);
		writeState({ ephemeral: false, url: allocated });
		process.stdout.write(`${allocated}\n`);
		return;
	}
	const url = await autoLaunch();
	process.stdout.write(`${url}\n`);
}

function down() {
	if (!existsSync(statePath)) {
		return;
	}
	const state = JSON.parse(readFileSync(statePath, "utf8"));
	if (state.ephemeral && state.containerName && state.engine) {
		engineArgs(state.engine, ["rm", "-f", state.containerName]);
	}
	unlinkSync(statePath);
}

const command = process.argv[2] ?? "up";
if (command === "down") {
	down();
} else if (command === "up") {
	up().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
} else {
	console.error(`unknown command ${command}`);
	process.exit(1);
}
