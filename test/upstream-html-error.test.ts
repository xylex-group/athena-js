import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import {
	isHtmlErrorPage,
	sanitizeAuthErrorMessage,
	UPSTREAM_UNAVAILABLE_MESSAGE,
} from "../src/http/upstream-html-error.ts";

const CF_1101 = `<!DOCTYPE html> <html class="no-js" lang="en-US"><head><title>Worker threw exception | auth.athena-auth.com | Cloudflare</title></head><body><span class="cf-error-code">1101</span><h2>Worker threw exception</h2></body></html>`;

test("isHtmlErrorPage detects Cloudflare 1101 Worker threw exception pages", () => {
	assert.equal(isHtmlErrorPage(CF_1101, "text/html"), true);
	assert.equal(isHtmlErrorPage('{"session":null}', "application/json"), false);
});

test("sanitizeAuthErrorMessage never returns Cloudflare HTML to callers", () => {
	assert.equal(sanitizeAuthErrorMessage(CF_1101), UPSTREAM_UNAVAILABLE_MESSAGE);
	assert.equal(sanitizeAuthErrorMessage("unauthorized"), "unauthorized");
});
