import { lookup as dnsLookup } from "node:dns/promises";
import http, {
	type IncomingMessage,
	type OutgoingHttpHeaders,
} from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import { isBlockedIpv4, parseIpv4 } from "../email/blocked-ip.ts";
import { assertAthenaEmailProviderRuntime } from "../email/capabilities.ts";
import {
	ATHENA_EMAIL_DELIVERY_FAILED,
	ATHENA_EMAIL_MESSAGE_INVALID,
	ATHENA_EMAIL_PROVIDER_INVALID,
	AthenaEmailError,
} from "../email/errors.ts";
import { defineAthenaEmailProvider } from "../email/provider.ts";
import {
	requireSendableBody,
	selectAttachments,
} from "../email/providers/attachments.ts";
import {
	envelopeAcceptedRecipients,
	toPublicEmailDeliveryResult,
} from "../email/runtime.ts";
import type {
	AthenaEmailAttachment,
	AthenaEmailProvider,
	AthenaResolvedEmailMessage,
} from "../email/types.ts";
import { buildSmtpMime, smtpDotStuff } from "./mime.ts";
import {
	type AthenaSmtpConnection,
	type AthenaSmtpReply,
	type AthenaSmtpTransport,
	createNodeSmtpTransport,
} from "./transport.ts";

export type AthenaSmtpSecure = "starttls" | "tls" | false;

const SMTP_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
const SMTP_ATTACHMENT_FETCH_TIMEOUT_MS = 15_000;

export interface AthenaSmtpAuth {
	pass: string;
	user: string;
}

export interface AthenaSmtpLookupAddress {
	address: string;
	family: 4 | 6;
}

export interface AthenaSmtpConfig {
	auth: AthenaSmtpAuth;
	host: string;
	port?: number;
	secure?: AthenaSmtpSecure;
	/**
	 * Connect, read, and write deadline in milliseconds. Defaults to 30s.
	 */
	timeoutMs?: number;
	/**
	 * Test seam. Production callers omit this and use Node `net`/`tls`.
	 */
	transport?: AthenaSmtpTransport;
	/** Test seam for attachment SSRF checks. */
	fetchImpl?: typeof fetch;
	lookupImpl?: (hostname: string) => Promise<AthenaSmtpLookupAddress[]>;
	/** Test seam. Production callers omit this (15s). */
	attachmentFetchTimeoutMs?: number;
}

const DEFAULT_SMTP_TIMEOUT_MS = 30_000;
const nativeFetch = globalThis.fetch;

function smtpTimeoutMs(value: number | undefined): number {
	if (value === undefined) {
		return DEFAULT_SMTP_TIMEOUT_MS;
	}
	if (!Number.isFinite(value) || value <= 0) {
		throw new AthenaEmailError(
			ATHENA_EMAIL_PROVIDER_INVALID,
			"SMTP timeoutMs must be a positive number.",
		);
	}
	return value;
}

async function withSmtpDeadline<T>(
	promise: Promise<T>,
	timeoutMs: number,
	action: string,
	onTimeout: () => void,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					onTimeout();
					reject(
						new AthenaEmailError(
							ATHENA_EMAIL_DELIVERY_FAILED,
							`SMTP ${action} timed out after ${timeoutMs}ms.`,
						),
					);
				}, timeoutMs);
			}),
		]);
	} finally {
		if (timer !== undefined) {
			clearTimeout(timer);
		}
	}
}

async function expectReply(
	connection: AthenaSmtpConnection,
	ok: (code: number) => boolean,
	action: string,
	timeoutMs: number,
): Promise<AthenaSmtpReply> {
	const reply = await withSmtpDeadline(
		connection.readReply(),
		timeoutMs,
		action,
		() => {
			void connection.close().catch(() => undefined);
		},
	);
	if (!ok(reply.code)) {
		throw new AthenaEmailError(
			ATHENA_EMAIL_DELIVERY_FAILED,
			`SMTP ${action} failed (${reply.code} ${reply.lines.join(" ")}).`,
		);
	}
	return reply;
}

async function command(
	connection: AthenaSmtpConnection,
	line: string,
	ok: (code: number) => boolean,
	action: string,
	timeoutMs: number,
): Promise<AthenaSmtpReply> {
	await withSmtpDeadline(
		connection.writeLine(line),
		timeoutMs,
		`${action} write`,
		() => {
			void connection.close().catch(() => undefined);
		},
	);
	return expectReply(connection, ok, action, timeoutMs);
}

function ehloOk(code: number): boolean {
	return code === 250;
}

function assertSmtpEnvelopeAddress(value: string, label: string): void {
	if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) {
		throw new AthenaEmailError(
			ATHENA_EMAIL_MESSAGE_INVALID,
			`SMTP ${label} must not contain CR or LF.`,
		);
	}
}

function parseHextetGroup(value: string): number[] | null {
	if (value.length === 0) {
		return [];
	}
	const groups = value.split(":");
	const hextets: number[] = [];
	for (const group of groups) {
		if (!/^[0-9a-f]{1,4}$/i.test(group)) {
			return null;
		}
		hextets.push(Number.parseInt(group, 16));
	}
	return hextets;
}

function parseIpv6(address: string): number[] | null {
	const raw = address.trim().toLowerCase();
	if (!raw.includes(":")) {
		return null;
	}
	let core = raw;
	let ipv4Tail: [number, number, number, number] | null = null;
	const lastColon = raw.lastIndexOf(":");
	const maybeIpv4 = parseIpv4(raw.slice(lastColon + 1));
	if (maybeIpv4) {
		ipv4Tail = maybeIpv4;
		core = raw.slice(0, lastColon);
	}
	if (core.includes(":::")) {
		return null;
	}
	const parts = core.split("::");
	if (parts.length > 2) {
		return null;
	}
	const left = parseHextetGroup(parts[0] ?? "");
	const right = parts.length === 2 ? parseHextetGroup(parts[1] ?? "") : [];
	if (!left || !right) {
		return null;
	}
	if (parts.length === 1) {
		const hextets = ipv4Tail
			? [
					...left,
					(ipv4Tail[0] << 8) | ipv4Tail[1],
					(ipv4Tail[2] << 8) | ipv4Tail[3],
				]
			: left;
		return hextets.length === 8 ? hextets : null;
	}
	const missing = 8 - left.length - right.length - (ipv4Tail ? 2 : 0);
	if (missing < 0) {
		return null;
	}
	const hextets = [
		...left,
		...Array.from({ length: missing }, () => 0),
		...right,
	];
	if (ipv4Tail) {
		hextets.push(
			(ipv4Tail[0] << 8) | ipv4Tail[1],
			(ipv4Tail[2] << 8) | ipv4Tail[3],
		);
	}
	return hextets.length === 8 ? hextets : null;
}

function ipv4MappedFromIpv6(
	hextets: number[],
): [number, number, number, number] | null {
	if (
		hextets[0] !== 0 ||
		hextets[1] !== 0 ||
		hextets[2] !== 0 ||
		hextets[3] !== 0 ||
		hextets[4] !== 0 ||
		hextets[5] !== 0xffff
	) {
		return null;
	}
	const hi = hextets[6] ?? 0;
	const lo = hextets[7] ?? 0;
	return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255];
}

function isBlockedIpv6(hextets: number[]): boolean {
	const mapped = ipv4MappedFromIpv6(hextets);
	if (mapped) {
		return isBlockedIpv4(mapped);
	}
	const first = hextets[0] ?? 0;
	const second = hextets[1] ?? 0;
	const third = hextets[2] ?? 0;
	// Global unicast is 2000::/3 (RFC 4291). Other prefixes are non-global
	// (unspecified, loopback, link-local, ULA, site-local, multicast, …).
	if ((first & 0xe000) !== 0x2000) {
		return true;
	}
	// IANA IPv6 Special-Purpose Address Registry allocations that sit inside
	// 2000::/3. Treating the whole /3 as publicly routable misses prefixes
	// such as 2001:2::/48 (benchmarking) that operators may still route.
	// 2001::/23 IETF Protocol Assignments (TEREDO, benchmarking, ORCHID, AMT, …).
	if (first === 0x2001 && (second & 0xfe00) === 0) {
		return true;
	}
	// 2001:db8::/32 documentation.
	if (first === 0x2001 && second === 0x0db8) {
		return true;
	}
	// 2002::/16 6to4.
	if (first === 0x2002) {
		return true;
	}
	// 3fff::/20 documentation (RFC 9637).
	if ((first & 0xfff0) === 0x3ff0) {
		return true;
	}
	// 2620:4f:8000::/48 Direct Delegation AS112 Service.
	if (first === 0x2620 && second === 0x004f && third === 0x8000) {
		return true;
	}
	return false;
}

function isBlockedIpAddress(address: string): boolean {
	const ipv4 = parseIpv4(address);
	if (ipv4) {
		return isBlockedIpv4(ipv4);
	}
	const hextets = parseIpv6(address);
	if (!hextets) {
		return address.includes(":");
	}
	return isBlockedIpv6(hextets);
}

function assertPublicHttpUrl(fileUrl: string): URL {
	let parsed: URL;
	try {
		parsed = new URL(fileUrl);
	} catch {
		throw new AthenaEmailError(
			ATHENA_EMAIL_MESSAGE_INVALID,
			"SMTP attachment URL is invalid.",
		);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new AthenaEmailError(
			ATHENA_EMAIL_MESSAGE_INVALID,
			"SMTP attachment URL must use http or https.",
		);
	}
	const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname.endsWith(".local")
	) {
		throw new AthenaEmailError(
			ATHENA_EMAIL_MESSAGE_INVALID,
			"SMTP attachment URL must not target a private host.",
		);
	}
	if (parseIpv4(hostname) || hostname.includes(":")) {
		if (isBlockedIpAddress(hostname)) {
			throw new AthenaEmailError(
				ATHENA_EMAIL_MESSAGE_INVALID,
				"SMTP attachment URL must not target a private address.",
			);
		}
	}
	return parsed;
}

function pinnedDispatcher(record: AthenaSmtpLookupAddress): {
	pin: AthenaSmtpLookupAddress;
} {
	return { pin: record };
}

function pinnedAddressFromInit(
	init: RequestInit | undefined,
): AthenaSmtpLookupAddress | null {
	if (!init || typeof init !== "object") {
		return null;
	}
	const dispatcher = (
		init as { dispatcher?: { pin?: AthenaSmtpLookupAddress } }
	).dispatcher;
	const pin = dispatcher?.pin;
	if (
		!pin ||
		typeof pin.address !== "string" ||
		(pin.family !== 4 && pin.family !== 6)
	) {
		return null;
	}
	return pin;
}

function fetchPinnedHttpUrl(
	parsed: URL,
	record: AthenaSmtpLookupAddress,
	init: RequestInit | undefined,
	timeoutMs: number,
): Promise<Response> {
	return new Promise((resolve, reject) => {
		const isHttps = parsed.protocol === "https:";
		const lib = isHttps ? https : http;
		const serverName = parsed.hostname.replace(/^\[|\]$/g, "");
		const headers = new Headers(init?.headers);
		if (!headers.has("host")) {
			headers.set("Host", parsed.host);
		}
		const headerObject: OutgoingHttpHeaders = {};
		headers.forEach((value, key) => {
			headerObject[key] = value;
		});
		const port =
			parsed.port === "" ? (isHttps ? 443 : 80) : Number(parsed.port);
		const req = lib.request(
			{
				family: record.family,
				headers: headerObject,
				hostname: record.address,
				method: typeof init?.method === "string" ? init.method : "GET",
				path: `${parsed.pathname}${parsed.search}`,
				port,
				servername: isHttps ? serverName : undefined,
				setHost: false,
				timeout: timeoutMs,
			},
			(res: IncomingMessage) => {
				const responseHeaders = new Headers();
				for (const [key, value] of Object.entries(res.headers)) {
					if (typeof value === "string") {
						responseHeaders.append(key, value);
					} else if (Array.isArray(value)) {
						for (const item of value) {
							responseHeaders.append(key, item);
						}
					}
				}
				resolve(
					new Response(Readable.toWeb(res) as ReadableStream<Uint8Array>, {
						headers: responseHeaders,
						status: res.statusCode ?? 0,
						statusText: res.statusMessage,
					}),
				);
			},
		);
		const abort = () => {
			req.destroy();
			reject(
				new AthenaEmailError(
					ATHENA_EMAIL_DELIVERY_FAILED,
					"SMTP attachment fetch timed out.",
				),
			);
		};
		const signal = init?.signal;
		if (signal) {
			if (signal.aborted) {
				abort();
				return;
			}
			signal.addEventListener("abort", abort, { once: true });
		}
		req.on("timeout", abort);
		req.on("error", reject);
		req.end();
	});
}

async function defaultPinnedFetch(
	input: RequestInfo | URL,
	init: RequestInit | undefined,
	timeoutMs: number,
): Promise<Response> {
	const pin = pinnedAddressFromInit(init);
	if (pin && globalThis.fetch === nativeFetch) {
		return fetchPinnedHttpUrl(new URL(String(input)), pin, init, timeoutMs);
	}
	return globalThis.fetch(input, init);
}

async function resolvePublicDestination(
	parsed: URL,
	lookupImpl: (hostname: string) => Promise<AthenaSmtpLookupAddress[]>,
	timeoutMs = SMTP_ATTACHMENT_FETCH_TIMEOUT_MS,
): Promise<AthenaSmtpLookupAddress | null> {
	const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
	if (parseIpv4(hostname) || hostname.includes(":")) {
		if (isBlockedIpAddress(hostname)) {
			throw new AthenaEmailError(
				ATHENA_EMAIL_MESSAGE_INVALID,
				"SMTP attachment URL must not target a private address.",
			);
		}
		return null;
	}
	const records = await withSmtpDeadline(
		lookupImpl(hostname),
		timeoutMs,
		"attachment DNS",
		() => undefined,
	);
	if (
		records.length === 0 ||
		records.some((record) => isBlockedIpAddress(record.address))
	) {
		throw new AthenaEmailError(
			ATHENA_EMAIL_MESSAGE_INVALID,
			"SMTP attachment URL resolved to a private address.",
		);
	}
	return records.find((record) => record.family === 4) ?? records[0] ?? null;
}

async function fetchPublicHttpUrl(
	fileUrl: string,
	fetchImpl: typeof fetch,
	lookupImpl: (hostname: string) => Promise<AthenaSmtpLookupAddress[]>,
	timeoutMs: number,
	hops = 0,
): Promise<Response> {
	if (hops > 5) {
		throw new AthenaEmailError(
			ATHENA_EMAIL_DELIVERY_FAILED,
			"SMTP attachment URL exceeded redirect limit.",
		);
	}
	const parsed = assertPublicHttpUrl(fileUrl);
	const verified = await resolvePublicDestination(
		parsed,
		lookupImpl,
		timeoutMs,
	);
	const headers = new Headers();
	const signal =
		typeof AbortSignal !== "undefined" &&
		typeof AbortSignal.timeout === "function"
			? AbortSignal.timeout(timeoutMs)
			: undefined;
	const init: RequestInit & { dispatcher?: { pin: AthenaSmtpLookupAddress } } =
		{
			redirect: "manual",
			headers,
			...(signal ? { signal } : {}),
		};
	if (verified) {
		init.dispatcher = pinnedDispatcher(verified);
	}
	const response = await fetchImpl(parsed.toString(), init);
	if (response.status >= 300 && response.status < 400) {
		const location = response.headers.get("location");
		if (!location) {
			throw new Error(`HTTP ${response.status} missing Location`);
		}
		const next = new URL(location, parsed).toString();
		return fetchPublicHttpUrl(next, fetchImpl, lookupImpl, timeoutMs, hops + 1);
	}
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}`);
	}
	return response;
}

async function readLimitedAttachmentBody(
	response: Response,
): Promise<Uint8Array> {
	const lengthHeader = response.headers.get("content-length");
	if (lengthHeader) {
		const declared = Number(lengthHeader);
		if (Number.isFinite(declared) && declared > SMTP_ATTACHMENT_MAX_BYTES) {
			throw new AthenaEmailError(
				ATHENA_EMAIL_DELIVERY_FAILED,
				"SMTP attachment exceeds size limit.",
			);
		}
	}
	const body = response.body;
	if (!body || typeof body.getReader !== "function") {
		const buffer = new Uint8Array(await response.arrayBuffer());
		if (buffer.byteLength > SMTP_ATTACHMENT_MAX_BYTES) {
			throw new AthenaEmailError(
				ATHENA_EMAIL_DELIVERY_FAILED,
				"SMTP attachment exceeds size limit.",
			);
		}
		return buffer;
	}
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		if (!value) {
			continue;
		}
		total += value.byteLength;
		if (total > SMTP_ATTACHMENT_MAX_BYTES) {
			await reader.cancel().catch(() => undefined);
			throw new AthenaEmailError(
				ATHENA_EMAIL_DELIVERY_FAILED,
				"SMTP attachment exceeds size limit.",
			);
		}
		chunks.push(value);
	}
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}

async function resolveSmtpAttachments(
	message: AthenaResolvedEmailMessage,
	fetchImpl: typeof fetch,
	lookupImpl: (hostname: string) => Promise<AthenaSmtpLookupAddress[]>,
	timeoutMs: number,
): Promise<AthenaEmailAttachment[]> {
	const resolved: AthenaEmailAttachment[] = [];
	for (const attachment of selectAttachments(message)) {
		if (attachment.content !== undefined) {
			resolved.push(attachment);
			continue;
		}
		const fileUrl = attachment.fileUrl?.trim();
		if (!fileUrl) {
			if (message.attachmentFailureMode === "skip") {
				continue;
			}
			throw new AthenaEmailError(
				ATHENA_EMAIL_DELIVERY_FAILED,
				"SMTP attachments require inline content; fileUrl is not fetched.",
			);
		}
		try {
			const response = await fetchPublicHttpUrl(
				fileUrl,
				fetchImpl,
				lookupImpl,
				timeoutMs,
			);
			resolved.push({
				...attachment,
				content: await readLimitedAttachmentBody(response),
			});
		} catch (cause) {
			if (message.attachmentFailureMode === "skip") {
				continue;
			}
			if (cause instanceof AthenaEmailError) {
				throw cause;
			}
			throw new AthenaEmailError(
				ATHENA_EMAIL_DELIVERY_FAILED,
				`SMTP could not fetch attachment ${fileUrl}.`,
				{ cause },
			);
		}
	}
	return resolved;
}

async function authenticate(
	connection: AthenaSmtpConnection,
	auth: AthenaSmtpAuth,
	capabilities: string,
	timeoutMs: number,
): Promise<void> {
	if (
		/\bAUTH\b[^\n]*\bPLAIN\b/i.test(capabilities) ||
		!/\bAUTH\b/i.test(capabilities)
	) {
		const token = Buffer.from(`\0${auth.user}\0${auth.pass}`, "utf8").toString(
			"base64",
		);
		await command(
			connection,
			`AUTH PLAIN ${token}`,
			(code) => code === 235,
			"AUTH PLAIN",
			timeoutMs,
		);
		return;
	}
	await command(
		connection,
		"AUTH LOGIN",
		(code) => code === 334,
		"AUTH LOGIN",
		timeoutMs,
	);
	await command(
		connection,
		Buffer.from(auth.user, "utf8").toString("base64"),
		(code) => code === 334,
		"AUTH LOGIN user",
		timeoutMs,
	);
	await command(
		connection,
		Buffer.from(auth.pass, "utf8").toString("base64"),
		(code) => code === 235,
		"AUTH LOGIN pass",
		timeoutMs,
	);
}

/**
 * Node-only SMTP adapter. STARTTLS on port 587 by default, matching
 * `SmtpEmailProvider` in Athena Auth (lettre). Sender identity belongs on
 * `createClient({ email: { defaults } })`, not here.
 */
export function smtp(config: AthenaSmtpConfig): AthenaEmailProvider {
	const host = config.host?.trim();
	if (!host) {
		throw new AthenaEmailError(
			ATHENA_EMAIL_PROVIDER_INVALID,
			"SMTP provider requires host.",
		);
	}
	const user = config.auth?.user?.trim();
	const pass = config.auth?.pass;
	if (!user || typeof pass !== "string" || pass.length === 0) {
		throw new AthenaEmailError(
			ATHENA_EMAIL_PROVIDER_INVALID,
			"SMTP provider requires auth.user and auth.pass.",
		);
	}
	const secure: AthenaSmtpSecure = config.secure ?? "starttls";
	const port = config.port ?? (secure === "tls" ? 465 : 587);
	const timeoutMs = smtpTimeoutMs(config.timeoutMs);
	const attachmentFetchTimeoutMs =
		config.attachmentFetchTimeoutMs === undefined
			? SMTP_ATTACHMENT_FETCH_TIMEOUT_MS
			: smtpTimeoutMs(config.attachmentFetchTimeoutMs);
	const transport = config.transport ?? createNodeSmtpTransport();
	const fetchImpl: typeof fetch =
		config.fetchImpl ??
		((input, init) =>
			defaultPinnedFetch(input, init, attachmentFetchTimeoutMs));
	const lookupImpl =
		config.lookupImpl ??
		(async (hostname: string) => {
			const records = await dnsLookup(hostname, { all: true });
			return records.map((record) => ({
				address: record.address,
				family: record.family === 6 ? (6 as const) : (4 as const),
			}));
		});

	const provider: AthenaEmailProvider = defineAthenaEmailProvider({
		capabilities: {
			delivery: "smtp",
			runtimes: ["node"],
		},
		id: "smtp",
		async send(message) {
			assertAthenaEmailProviderRuntime(provider);
			requireSendableBody(message);
			assertSmtpEnvelopeAddress(message.from, "MAIL FROM");
			for (const recipient of [...message.to, ...message.cc, ...message.bcc]) {
				assertSmtpEnvelopeAddress(recipient, "RCPT TO");
			}
			const attachments = await resolveSmtpAttachments(
				message,
				fetchImpl,
				lookupImpl,
				attachmentFetchTimeoutMs,
			);

			const connection = await withSmtpDeadline(
				transport({
					host,
					implicitTls: secure === "tls",
					port,
					timeoutMs,
				}),
				timeoutMs,
				"connect",
				() => undefined,
			);
			try {
				await expectReply(
					connection,
					(code) => code === 220,
					"connect",
					timeoutMs,
				);
				let ehlo = await command(
					connection,
					`EHLO ${host}`,
					ehloOk,
					"EHLO",
					timeoutMs,
				);
				if (secure === "starttls") {
					await command(
						connection,
						"STARTTLS",
						(code) => code === 220,
						"STARTTLS",
						timeoutMs,
					);
					await withSmtpDeadline(
						connection.startTls(),
						timeoutMs,
						"STARTTLS upgrade",
						() => {
							void connection.close().catch(() => undefined);
						},
					);
					ehlo = await command(
						connection,
						`EHLO ${host}`,
						ehloOk,
						"EHLO",
						timeoutMs,
					);
				}
				await authenticate(
					connection,
					{ pass, user },
					ehlo.lines.join("\n"),
					timeoutMs,
				);
				await command(
					connection,
					`MAIL FROM:<${message.from}>`,
					(code) => code === 250,
					"MAIL FROM",
					timeoutMs,
				);
				for (const recipient of [
					...message.to,
					...message.cc,
					...message.bcc,
				]) {
					await command(
						connection,
						`RCPT TO:<${recipient}>`,
						(code) => code === 250 || code === 251,
						"RCPT TO",
						timeoutMs,
					);
				}
				await command(
					connection,
					"DATA",
					(code) => code === 354,
					"DATA",
					timeoutMs,
				);
				const mime = smtpDotStuff(buildSmtpMime({ ...message, attachments }));
				await withSmtpDeadline(
					connection.writeData(`${mime}\r\n.\r\n`),
					timeoutMs,
					"DATA body write",
					() => {
						void connection.close().catch(() => undefined);
					},
				);
				const done = await expectReply(
					connection,
					(code) => code === 250,
					"DATA body",
					timeoutMs,
				);
				await command(
					connection,
					"QUIT",
					(code) => code === 221 || code === 250,
					"QUIT",
					timeoutMs,
				);
				const messageId = done.lines.join(" ").match(/<([^>]+)>/)?.[1];
				return toPublicEmailDeliveryResult(
					{
						accepted: envelopeAcceptedRecipients(message),
						messageId,
						provider: "smtp",
						rejected: [],
						success: true,
					},
					"smtp",
				);
			} catch (cause) {
				if (cause instanceof AthenaEmailError) {
					throw cause;
				}
				throw new AthenaEmailError(
					ATHENA_EMAIL_DELIVERY_FAILED,
					"SMTP email delivery failed.",
					{ cause },
				);
			} finally {
				await connection.close().catch(() => undefined);
			}
		},
	});
	return provider;
}

export { createMemorySmtpTransport } from "./memory-transport.ts";
export { createNodeSmtpTransport } from "./transport.ts";
