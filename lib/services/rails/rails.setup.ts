import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads .env.local for the rails suite and refuses to run against anything but a
 * local database. Every test empties the booking tables first; pointed at the
 * shared Supabase, that would be someone's real bookings.
 */
const envFile = resolve(process.cwd(), ".env.local");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

// A database of its own when one is given, so a test run never empties the one a
// developer is clicking around in.
if (process.env.RAILS_TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.RAILS_TEST_DATABASE_URL;

const url = process.env.DATABASE_URL ?? "";
let host = "";
try {
  host = new URL(url).hostname;
} catch {
  // Unparseable is treated the same as remote.
}
if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
  throw new Error(`The rails suite only runs against a local database (DATABASE_URL host is "${host || "unset"}").`);
}
