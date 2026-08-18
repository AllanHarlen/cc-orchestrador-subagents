import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }
    const equals = token.indexOf("=");
    const key = token.slice(2, equals === -1 ? undefined : equals);
    let value = equals === -1 ? undefined : token.slice(equals + 1);
    if (value === undefined && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      value = argv[index + 1];
      index += 1;
    }
    if (value === undefined) value = true;
    if (result[key] === undefined) result[key] = value;
    else if (Array.isArray(result[key])) result[key].push(value);
    else result[key] = [result[key], value];
  }
  return result;
}

export function required(args, key, fallback = undefined) {
  const value = args[key] ?? fallback;
  if (value === undefined || value === "") {
    const error = new Error(`Missing required argument --${key}`);
    error.code = "MISSING_ARGUMENT";
    throw error;
  }
  return value;
}

export function numberArg(value, fallback = undefined) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    const error = new Error(`Expected a number, received ${value}`);
    error.code = "INVALID_NUMBER";
    throw error;
  }
  return parsed;
}

export function boolArg(value, fallback = undefined) {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  if (["true", "yes", "1"].includes(String(value).toLowerCase())) return true;
  if (["false", "no", "0"].includes(String(value).toLowerCase())) return false;
  const error = new Error(`Expected a boolean, received ${value}`);
  error.code = "INVALID_BOOLEAN";
  throw error;
}

export function jsonArg(value, fallback = undefined) {
  if (value === undefined) return fallback;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    const wrapped = new Error(`Invalid JSON argument: ${error.message}`);
    wrapped.code = "INVALID_JSON_ARGUMENT";
    throw wrapped;
  }
}

export function readJsonFile(path) {
  const absolute = resolve(path);
  try {
    return JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    const wrapped = new Error(`Could not read JSON file ${absolute}: ${error.message}`);
    wrapped.code = "INVALID_JSON_FILE";
    throw wrapped;
  }
}

export function executeJsonCli(main) {
  Promise.resolve()
    .then(() => main(process.argv.slice(2)))
    .then((result) => {
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ok: false,
        error: {
          code: error?.code ?? "UNEXPECTED_ERROR",
          message: error?.message ?? String(error),
          details: error?.details,
        },
      }, null, 2));
      process.exitCode = ["RUN_NOT_FOUND", "MISSING_ARGUMENT"].includes(error?.code) ? 2 : 1;
    });
}
