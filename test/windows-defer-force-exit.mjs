/**
 * `--test-force-exit` on Windows races uv_async handles that are already
 * UV_HANDLE_CLOSING (`src/win/async.c`) — typically `spawnSync("git")` pipes
 * or `pgsql-parser` teardown. Delay `process.exit` so those handles finish.
 */
if (process.platform === "win32") {
	const rawExit = process.exit.bind(process);
	let deferred = false;
	process.exit = /** @type {typeof process.exit} */ (
		(code) => {
			if (deferred) {
				rawExit(code);
				return undefined;
			}
			deferred = true;
			setTimeout(() => {
				rawExit(code);
			}, 400);
			return undefined;
		}
	);
}
