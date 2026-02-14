/**
 * Concrete demonstration: What does c12's loadConfig() return for each
 * real-world auth.ts export pattern?
 *
 * These tests prove the runtime shapes that getOptions() must handle,
 * and validate the fix for both explicit-path (Path 1) and auto-discovery
 * (Path 2) code paths.
 *
 * The auth instance returned by betterAuth() has this shape:
 *   { handler, api, options: <raw BetterAuthOptions>, $context, $ERROR_CODES }
 * (see packages/better-auth/src/auth/base.ts lines 24-56)
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "c12";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "../src/utils/get-config";

// Inline betterAuth stub that produces the same shape as the real one.
// We inline it so c12/jiti don't need to resolve the real better-auth package.
const fakeBetterAuth = `
const betterAuth = (opts) => ({
  handler: async () => {},
  api: {},
  options: opts,
  $context: {},
  $ERROR_CODES: {},
});
`;

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "c12-shapes-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true });
});

async function loadShape(fileContent: string) {
	const filePath = path.join(tmpDir, "auth.mjs");
	fs.writeFileSync(filePath, fileContent);
	const { config } = await loadConfig({ configFile: filePath });
	return config as Record<string, unknown>;
}

// ─── Part 1: Prove what c12 returns for each export pattern ──────────────

describe("c12 loadConfig() runtime shapes", () => {
	it("named export: config = { auth: authInstance }", async () => {
		const config = await loadShape(`
${fakeBetterAuth}
export const auth = betterAuth({ emailAndPassword: { enabled: true } });
`);

		// c12 resolver: mod.default is undefined → returns mod (whole module)
		expect("auth" in config).toBe(true);
		expect("default" in config).toBe(false);
		expect("options" in config).toBe(false);

		// config.auth.options is the raw BetterAuthOptions
		const auth = config.auth as Record<string, unknown>;
		expect(auth.options).toEqual({ emailAndPassword: { enabled: true } });
	});

	it("default export only: config = authInstance (unwrapped)", async () => {
		const config = await loadShape(`
${fakeBetterAuth}
export default betterAuth({ emailAndPassword: { enabled: true } });
`);

		// c12 resolver: mod.default exists → returns it directly
		expect("auth" in config).toBe(false);
		expect("default" in config).toBe(false);
		expect("options" in config).toBe(true);
		expect("handler" in config).toBe(true);

		// config.options is the raw BetterAuthOptions
		expect(config.options).toEqual({ emailAndPassword: { enabled: true } });
	});

	it("default export of variable: config = authInstance (unwrapped)", async () => {
		const config = await loadShape(`
${fakeBetterAuth}
const auth = betterAuth({ emailAndPassword: { enabled: true } });
export default auth;
`);

		expect("auth" in config).toBe(false);
		expect("options" in config).toBe(true);
		expect("handler" in config).toBe(true);
		expect(config.options).toEqual({ emailAndPassword: { enabled: true } });
	});

	it("BOTH named + default: config = authInstance (c12 prefers default, named lost)", async () => {
		const config = await loadShape(`
${fakeBetterAuth}
export const auth = betterAuth({ emailAndPassword: { enabled: true } });
export default auth;
`);

		// c12 resolver: mod.default is truthy → returns it, named "auth" is lost
		expect("auth" in config).toBe(false);
		expect("options" in config).toBe(true);
		expect("handler" in config).toBe(true);
		expect(config.options).toEqual({ emailAndPassword: { enabled: true } });
	});
});

// ─── Part 2: getConfig with explicit configPath (Path 1) ────────────────

describe("getConfig with configPath (Path 1)", () => {
	it("handles named export", async () => {
		fs.writeFileSync(
			path.join(tmpDir, "auth.ts"),
			`${fakeBetterAuth}
			export const auth = betterAuth({ emailAndPassword: { enabled: true } });`,
		);

		const config = await getConfig({
			cwd: tmpDir,
			configPath: "auth.ts",
			shouldThrowOnError: true,
		});

		expect(config).toMatchObject({ emailAndPassword: { enabled: true } });
	});

	it("handles default export", async () => {
		fs.writeFileSync(
			path.join(tmpDir, "auth.ts"),
			`${fakeBetterAuth}
			export default betterAuth({ emailAndPassword: { enabled: true } });`,
		);

		const config = await getConfig({
			cwd: tmpDir,
			configPath: "auth.ts",
			shouldThrowOnError: true,
		});

		expect(config).toMatchObject({ emailAndPassword: { enabled: true } });
	});

	it("handles both named + default export", async () => {
		fs.writeFileSync(
			path.join(tmpDir, "auth.ts"),
			`${fakeBetterAuth}
			export const auth = betterAuth({ emailAndPassword: { enabled: true } });
			export default auth;`,
		);

		const config = await getConfig({
			cwd: tmpDir,
			configPath: "auth.ts",
			shouldThrowOnError: true,
		});

		expect(config).toMatchObject({ emailAndPassword: { enabled: true } });
	});
});

// ─── Part 3: getConfig via auto-discovery (Path 2) ──────────────────────
//
// This is the code path that was broken for default exports.
// We place the auth file at a location in possiblePaths (e.g. lib/auth.ts)
// and do NOT pass configPath, forcing auto-discovery.

describe("getConfig via auto-discovery (Path 2)", () => {
	it("handles named export", async () => {
		const libDir = path.join(tmpDir, "lib");
		fs.mkdirSync(libDir, { recursive: true });
		fs.writeFileSync(
			path.join(libDir, "auth.ts"),
			`${fakeBetterAuth}
			export const auth = betterAuth({ emailAndPassword: { enabled: true } });`,
		);

		const config = await getConfig({
			cwd: tmpDir,
			shouldThrowOnError: true,
		});

		expect(config).toMatchObject({ emailAndPassword: { enabled: true } });
	});

	/**
	 * @see https://github.com/better-auth/better-auth/issues/1215
	 */
	it("handles default export", async () => {
		const libDir = path.join(tmpDir, "lib");
		fs.mkdirSync(libDir, { recursive: true });
		fs.writeFileSync(
			path.join(libDir, "auth.ts"),
			`${fakeBetterAuth}
			export default betterAuth({ emailAndPassword: { enabled: true } });`,
		);

		const config = await getConfig({
			cwd: tmpDir,
			shouldThrowOnError: true,
		});

		expect(config).toMatchObject({ emailAndPassword: { enabled: true } });
	});

	/**
	 * @see https://github.com/better-auth/better-auth/issues/1215
	 */
	it("handles default export of variable", async () => {
		const libDir = path.join(tmpDir, "lib");
		fs.mkdirSync(libDir, { recursive: true });
		fs.writeFileSync(
			path.join(libDir, "auth.ts"),
			`${fakeBetterAuth}
			const auth = betterAuth({ emailAndPassword: { enabled: true } });
			export default auth;`,
		);

		const config = await getConfig({
			cwd: tmpDir,
			shouldThrowOnError: true,
		});

		expect(config).toMatchObject({ emailAndPassword: { enabled: true } });
	});

	/**
	 * @see https://github.com/better-auth/better-auth/issues/1215
	 */
	it("handles both named + default export", async () => {
		const libDir = path.join(tmpDir, "lib");
		fs.mkdirSync(libDir, { recursive: true });
		fs.writeFileSync(
			path.join(libDir, "auth.ts"),
			`${fakeBetterAuth}
			export const auth = betterAuth({ emailAndPassword: { enabled: true } });
			export default auth;`,
		);

		const config = await getConfig({
			cwd: tmpDir,
			shouldThrowOnError: true,
		});

		expect(config).toMatchObject({ emailAndPassword: { enabled: true } });
	});
});
