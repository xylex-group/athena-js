import { connect as netConnect, type Socket } from "node:net";
import { type TLSSocket, connect as tlsConnect } from "node:tls";

export interface AthenaSmtpReply {
	code: number;
	lines: string[];
}

export interface AthenaSmtpConnection {
	close(): Promise<void>;
	readReply(): Promise<AthenaSmtpReply>;
	startTls(): Promise<void>;
	writeData(data: string): Promise<void>;
	writeLine(line: string): Promise<void>;
}

export interface AthenaSmtpConnectInput {
	host: string;
	implicitTls: boolean;
	port: number;
	timeoutMs?: number;
}

export type AthenaSmtpTransport = (
	input: AthenaSmtpConnectInput,
) => Promise<AthenaSmtpConnection>;

/** Idle/connect/read/write deadline for Node SMTP sockets. */
export const SMTP_IO_TIMEOUT_MS = 30_000;

function smtpTimeoutError(action: string): Error {
	return new Error(`SMTP ${action} timed out`);
}

function connectSocket(
	input: AthenaSmtpConnectInput,
	timeoutMs: number,
): Promise<Socket | TLSSocket> {
	return new Promise((resolve, reject) => {
		const connected = input.implicitTls
			? tlsConnect({ host: input.host, port: input.port })
			: netConnect({ host: input.host, port: input.port });
		const timer = setTimeout(() => {
			connected.destroy();
			reject(smtpTimeoutError("connect"));
		}, timeoutMs);
		const succeed = () => {
			clearTimeout(timer);
			resolve(connected);
		};
		if (input.implicitTls) {
			connected.once("secureConnect", succeed);
		} else {
			connected.once("connect", succeed);
		}
		connected.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}

class NodeSmtpConnection implements AthenaSmtpConnection {
	private buffer = "";
	private socket: Socket | TLSSocket;
	private waiters: Array<(chunk: string) => void> = [];

	constructor(
		private readonly host: string,
		socket: Socket | TLSSocket,
		private readonly timeoutMs: number,
	) {
		this.socket = socket;
		this.bindSocket(socket);
	}

	async readReply(): Promise<AthenaSmtpReply> {
		const lines: string[] = [];
		for (;;) {
			const line = await this.readLine();
			const code = Number(line.slice(0, 3));
			const text = line.slice(4);
			lines.push(text);
			if (line.charAt(3) === " ") {
				return { code, lines };
			}
		}
	}

	async writeLine(line: string): Promise<void> {
		await this.writeData(`${line}\r\n`);
	}

	writeData(data: string): Promise<void> {
		return this.withTimeout(
			"write",
			new Promise((resolve, reject) => {
				this.socket.write(data, (error) => {
					if (error) {
						reject(error);
						return;
					}
					resolve();
				});
			}),
		);
	}

	async startTls(): Promise<void> {
		const upgraded = await this.withTimeout(
			"STARTTLS",
			new Promise<TLSSocket>((resolve, reject) => {
				const next = tlsConnect(
					{
						host: this.host,
						socket: this.socket,
					},
					() => resolve(next),
				);
				next.once("error", reject);
			}),
		);
		this.socket.removeAllListeners("data");
		this.socket.removeAllListeners("timeout");
		this.socket = upgraded;
		this.bindSocket(upgraded);
	}

	close(): Promise<void> {
		if (this.isSocketClosed()) {
			return Promise.resolve();
		}
		return this.withTimeout(
			"close",
			new Promise<void>((resolve) => {
				if (this.isSocketClosed()) {
					resolve();
					return;
				}
				this.socket.once("close", () => resolve());
				this.socket.end();
			}),
		).catch(() => {
			this.socket.destroy();
		});
	}

	private isSocketClosed(): boolean {
		return this.socket.destroyed || this.socket.closed;
	}

	private bindSocket(socket: Socket | TLSSocket): void {
		socket.setEncoding("utf8");
		socket.setTimeout(this.timeoutMs);
		socket.on("data", (chunk: string) => {
			const waiter = this.waiters.shift();
			if (waiter) {
				waiter(chunk);
			} else {
				this.buffer += chunk;
			}
		});
		socket.on("timeout", () => {
			socket.destroy(smtpTimeoutError("socket"));
		});
	}

	private withTimeout<T>(action: string, promise: Promise<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.socket.destroy();
				reject(smtpTimeoutError(action));
			}, this.timeoutMs);
			promise.then(
				(value) => {
					clearTimeout(timer);
					resolve(value);
				},
				(error: unknown) => {
					clearTimeout(timer);
					reject(error);
				},
			);
		});
	}

	private async readLine(): Promise<string> {
		for (;;) {
			const index = this.buffer.indexOf("\n");
			if (index >= 0) {
				const line = this.buffer.slice(0, index).replace(/\r$/, "");
				this.buffer = this.buffer.slice(index + 1);
				return line;
			}
			this.buffer += await this.readChunk();
		}
	}

	private readChunk(): Promise<string> {
		return this.withTimeout(
			"read",
			new Promise((resolve, reject) => {
				this.waiters.push(resolve);
				this.socket.once("error", reject);
				this.socket.once("end", () =>
					reject(new Error("SMTP connection closed")),
				);
			}),
		);
	}
}

export function createNodeSmtpTransport(): AthenaSmtpTransport {
	return async (input) => {
		const timeoutMs = input.timeoutMs ?? SMTP_IO_TIMEOUT_MS;
		const socket = await connectSocket(input, timeoutMs);
		return new NodeSmtpConnection(input.host, socket, timeoutMs);
	};
}
