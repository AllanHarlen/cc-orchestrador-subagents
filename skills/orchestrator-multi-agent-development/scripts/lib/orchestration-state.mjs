import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  ftruncateSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  ARTIFACT_LAYOUT_VERSION,
  SUPPORTED_ARTIFACT_LAYOUT_VERSIONS,
  artifactExists,
  ensureArtifactLayout,
  resolveArtifact,
} from "./artifact-layout.mjs";

export const STATE_SCHEMA_VERSION = 1;
export const EVENT_SCHEMA_VERSION = 1;

export const TASK_STATUSES = Object.freeze([
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
  "BLOCKED",
  "STALLED",
  "CANCELLED",
  "UNKNOWN",
]);

export const PHASE_STATUSES = Object.freeze([
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
  "BLOCKED",
  "CANCELLED",
  "UNKNOWN",
]);

export const RUN_STATUSES = Object.freeze([
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
  "BLOCKED",
  "STALLED",
  "CANCELLED",
  "UNKNOWN",
]);

export const GATE_STATUSES = Object.freeze([
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
  "BLOCKED",
  "N/A",
]);

const TASK_STATUS_SET = new Set(TASK_STATUSES);
const PHASE_STATUS_SET = new Set(PHASE_STATUSES);
const RUN_STATUS_SET = new Set(RUN_STATUSES);
const GATE_STATUS_SET = new Set(GATE_STATUSES);
const TERMINAL_TASK_STATUSES = new Set(["DONE", "CANCELLED"]);
const TERMINAL_RUN_STATUSES = new Set(["DONE", "CANCELLED"]);
const ACTIVE_RUN_STATUSES = new Set([
  "PENDING",
  "RUNNING",
  "FAILED",
  "BLOCKED",
  "STALLED",
  "UNKNOWN",
]);

const RUN_TRANSITIONS = Object.freeze({
  PENDING: new Set(["RUNNING", "BLOCKED", "CANCELLED", "UNKNOWN"]),
  RUNNING: new Set(["DONE", "FAILED", "BLOCKED", "STALLED", "CANCELLED", "UNKNOWN"]),
  DONE: new Set(),
  FAILED: new Set(["RUNNING", "BLOCKED", "CANCELLED", "UNKNOWN"]),
  BLOCKED: new Set(["RUNNING", "FAILED", "CANCELLED", "UNKNOWN"]),
  STALLED: new Set(["RUNNING", "FAILED", "BLOCKED", "CANCELLED", "UNKNOWN"]),
  CANCELLED: new Set(),
  UNKNOWN: new Set(["RUNNING", "FAILED", "BLOCKED", "STALLED", "CANCELLED"]),
});

export const COMPLETION_GATE_DEFINITIONS = Object.freeze({
  backendReview: { phase: 8, label: "Back-end review" },
  frontendReview: { phase: 9, label: "Front-end review" },
  browserE2E: { phase: 9.5, label: "Real-browser E2E", waivable: true },
  reports: { phase: 10, label: "Reports" },
  handoff: { phase: 10, label: "Handoff" },
  delivery: { phase: 11, label: "Delivery" },
  learning: { phase: 12, label: "Learning" },
});

const TASK_TRANSITIONS = Object.freeze({
  PENDING: new Set(["RUNNING", "BLOCKED", "CANCELLED", "UNKNOWN"]),
  RUNNING: new Set(["DONE", "FAILED", "BLOCKED", "STALLED", "CANCELLED", "UNKNOWN"]),
  DONE: new Set(),
  FAILED: new Set(["RUNNING", "BLOCKED", "CANCELLED", "UNKNOWN"]),
  BLOCKED: new Set(["RUNNING", "CANCELLED", "UNKNOWN"]),
  STALLED: new Set(["RUNNING", "FAILED", "BLOCKED", "CANCELLED", "UNKNOWN"]),
  CANCELLED: new Set(),
  UNKNOWN: new Set(["RUNNING", "DONE", "FAILED", "BLOCKED", "STALLED", "CANCELLED"]),
});

const CATEGORY_VALUES = [
  "BACKEND_ONLY",
  "FRONTEND_ONLY",
  "FULLSTACK",
  "DATABASE_ONLY",
  "REVIEW_ONLY",
  "DOCS_ONLY",
];

// O lookahead descarta versao (`gemini-3.5`): sem ele, o nome de modelo AGY presente em
// tasks-classification.md/waves.md seria lido como task e criaria uma entrada fantasma.
// scripts/validate-routing.mjs precisa usar exatamente esta mesma gramatica.
const TASK_ID_SOURCE = "(?:[A-Z]{1,8}-\\d{1,4}(?!\\.\\d)(?:-[A-Z0-9]+)?|T\\d+(?:-[A-Z0-9]+)?)";
const TASK_ID_RE = new RegExp(`\\b${TASK_ID_SOURCE}\\b`, "gi");
const TASK_ID_EXACT_RE = new RegExp(`^${TASK_ID_SOURCE}$`, "i");
const PHASE_NAMES = Object.freeze({
  0: "preflight",
  1: "specification-ingestion",
  2: "task-classification",
  3: "waves",
  4: "contracts-and-design-materialization",
  5: "delegation",
  6: "monitoring",
  7: "integration",
  8: "backend-review",
  9: "frontend-review",
  9.5: "browser-e2e",
  10: "reports-and-handoff",
  11: "delivery",
  12: "learning",
});
const PHASE_SEQUENCE = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 9.5, 10, 11, 12]);

export class OrchestrationStateError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "OrchestrationStateError";
    this.code = code;
    this.details = details;
  }
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new OrchestrationStateError("INVALID_TIME", `Invalid timestamp: ${value}`);
  }
  return date.toISOString();
}

function asDate(value = new Date()) {
  return value instanceof Date ? value : new Date(value);
}

function toPosix(value) {
  return value.split(sep).join("/");
}

function safeJsonParse(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new OrchestrationStateError(
      "INVALID_JSON",
      `${label} contains invalid JSON: ${error.message}`,
    );
  }
}

function stateFile(artifactDir) {
  return join(resolve(artifactDir), "state.json");
}

function eventsFile(artifactDir) {
  return join(resolve(artifactDir), "events.jsonl");
}

function lockFile(artifactDir) {
  return join(resolve(artifactDir), ".state.lock");
}

function sleepSync(milliseconds) {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, milliseconds);
}

function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireLock(artifactDir, options = {}) {
  const directory = resolve(artifactDir);
  mkdirSync(directory, { recursive: true });
  const path = lockFile(directory);
  const attempts = Number(options.lockAttempts ?? 40);
  const retryMs = Number(options.lockRetryMs ?? 50);
  const staleMs = Number(options.lockStaleMs ?? 120_000);
  const token = randomUUID();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const fd = openSync(path, "wx", 0o600);
      const payload = JSON.stringify({
        token,
        pid: process.pid,
        acquiredAt: new Date().toISOString(),
      });
      writeFileSync(fd, `${payload}\n`, "utf8");
      fsyncSync(fd);
      return { fd, path, token };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      try {
        const info = safeJsonParse(readFileSync(path, "utf8"), path);
        const ageMs = Date.now() - new Date(info.acquiredAt).getTime();
        if (ageMs > staleMs && !pidIsAlive(Number(info.pid))) {
          unlinkSync(path);
          continue;
        }
      } catch (readError) {
        if (readError?.code === "ENOENT") continue;
        try {
          const ageMs = Date.now() - statSync(path).mtimeMs;
          if (ageMs > staleMs) {
            unlinkSync(path);
            continue;
          }
        } catch (statError) {
          if (statError?.code === "ENOENT") continue;
        }
      }

      if (attempt < attempts - 1) sleepSync(retryMs);
    }
  }

  throw new OrchestrationStateError(
    "STATE_LOCKED",
    `Could not acquire orchestration state lock: ${path}`,
  );
}

function releaseLock(lock) {
  try {
    closeSync(lock.fd);
  } finally {
    try {
      const current = safeJsonParse(readFileSync(lock.path, "utf8"), lock.path);
      if (current.token === lock.token) unlinkSync(lock.path);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        // A stale lock is safer than deleting a lock now owned by another process.
      }
    }
  }
}

function withLock(artifactDir, callback, options = {}) {
  const lock = acquireLock(artifactDir, options);
  try {
    return callback();
  } finally {
    releaseLock(lock);
  }
}

function appendEventDurably(path, event) {
  mkdirSync(dirname(path), { recursive: true });
  const fd = openSync(path, "a", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(event)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function writeSnapshotAtomically(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(
    dirname(path),
    `.state.${process.pid}.${randomUUID()}.tmp`,
  );
  let fd;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try {
      if (existsSync(temporary)) unlinkSync(temporary);
    } catch {
      // Preserve the original error.
    }
    throw error;
  }
}

function repairIncompleteEventTail(path) {
  if (!existsSync(path)) return false;
  const contents = readFileSync(path);
  if (contents.length === 0 || contents.at(-1) === 0x0a) return false;

  const lastNewline = contents.lastIndexOf(0x0a);
  const tailStart = lastNewline + 1;
  const tail = contents.subarray(tailStart).toString("utf8").trim();
  let keepTail = false;
  if (tail) {
    try {
      JSON.parse(tail);
      keepTail = true;
    } catch {
      // An incomplete final event was never durable and is safe to discard.
    }
  }

  const fd = openSync(path, keepTail ? "a" : "r+");
  try {
    if (keepTail) {
      writeFileSync(fd, "\n", "utf8");
    } else {
      ftruncateSync(fd, tailStart);
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return true;
}

function readEvents(artifactDir) {
  const path = eventsFile(artifactDir);
  if (!existsSync(path)) return { events: [], truncatedTail: false };
  const contents = readFileSync(path, "utf8");
  const lines = contents.split(/\r?\n/);
  const events = [];
  let truncatedTail = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      const isTruncatedTail = index === lines.length - 1 && !contents.endsWith("\n");
      if (isTruncatedTail) {
        truncatedTail = true;
        break;
      }
      throw new OrchestrationStateError(
        "INVALID_JSON",
        `${path}:${index + 1} contains invalid JSON: ${error.message}`,
      );
    }
    if (
      event.eventSchemaVersion !== EVENT_SCHEMA_VERSION ||
      !event.eventId ||
      !Number.isInteger(event.revision) ||
      event.revision < 1 ||
      !event.type
    ) {
      throw new OrchestrationStateError(
        "INVALID_EVENT",
        `${path}:${index + 1} is not a valid orchestration event`,
        { event },
      );
    }
    events.push(event);
  }
  return { events, truncatedTail };
}

function validateTask(taskId, task) {
  if (!TASK_ID_EXACT_RE.test(taskId)) {
    throw new OrchestrationStateError("INVALID_TASK_ID", `Invalid task id: ${taskId}`);
  }
  if (!TASK_STATUS_SET.has(task.status)) {
    throw new OrchestrationStateError(
      "INVALID_TASK_STATUS",
      `Task ${taskId} has invalid status ${task.status}`,
    );
  }
  if (!Number.isInteger(task.attempt) || task.attempt < 0) {
    throw new OrchestrationStateError(
      "INVALID_ATTEMPT",
      `Task ${taskId} has invalid attempt ${task.attempt}`,
    );
  }
  for (const field of ["apiCalls", "toolCalls"]) {
    if (!Number.isInteger(task[field]) || task[field] < 0) {
      throw new OrchestrationStateError(
        "INVALID_ACTIVITY_COUNTER",
        `Task ${taskId} has invalid ${field} ${task[field]}`,
      );
    }
  }
}

function validateCompletionGates(gates) {
  if (gates == null) return;
  if (typeof gates !== "object" || Array.isArray(gates)) {
    throw new OrchestrationStateError(
      "INVALID_COMPLETION_GATES",
      "completionGates must be an object",
    );
  }
  for (const [gateId, definition] of Object.entries(COMPLETION_GATE_DEFINITIONS)) {
    const gate = gates[gateId];
    if (!gate || !GATE_STATUS_SET.has(gate.status)) {
      throw new OrchestrationStateError(
        "INVALID_COMPLETION_GATE",
        `Completion gate ${gateId} is missing or has an invalid status`,
      );
    }
    if (typeof gate.required !== "boolean") {
      throw new OrchestrationStateError(
        "INVALID_COMPLETION_GATE",
        `Completion gate ${gateId} must declare required as a boolean`,
      );
    }
    if (gate.requiredOverride != null && typeof gate.requiredOverride !== "boolean") {
      throw new OrchestrationStateError(
        "INVALID_COMPLETION_GATE",
        `Completion gate ${gateId} has an invalid requiredOverride`,
      );
    }
    if (gate.requiredOverride === false && !definition.waivable) {
      throw new OrchestrationStateError(
        "INVALID_COMPLETION_GATE",
        `Completion gate ${gateId} cannot override required applicability`,
      );
    }
    if (gate.phase !== definition.phase) {
      throw new OrchestrationStateError(
        "INVALID_COMPLETION_GATE",
        `Completion gate ${gateId} must belong to phase ${definition.phase}`,
      );
    }
    if (gate.required && gate.status === "N/A") {
      throw new OrchestrationStateError(
        "INVALID_COMPLETION_GATE",
        `Required completion gate ${gateId} cannot be N/A`,
      );
    }
  }
}

function assertRunMutable(state, operation = "mutate") {
  if (TERMINAL_RUN_STATUSES.has(state.status)) {
    throw new OrchestrationStateError(
      "RUN_TERMINAL",
      `Run ${state.runId} is ${state.status} and cannot ${operation}`,
      { runId: state.runId, status: state.status, operation },
    );
  }
}

function assertRunTransition(state, nextStatus) {
  if (state.status === nextStatus) return;
  if (!RUN_TRANSITIONS[state.status]?.has(nextStatus)) {
    throw new OrchestrationStateError(
      "INVALID_RUN_TRANSITION",
      `Run ${state.runId} cannot transition from ${state.status} to ${nextStatus}`,
    );
  }
}

export function validateState(state) {
  if (!state || state.schemaVersion !== STATE_SCHEMA_VERSION) {
    throw new OrchestrationStateError(
      "UNSUPPORTED_STATE_SCHEMA",
      `Expected state schema ${STATE_SCHEMA_VERSION}`,
    );
  }
  if (!state.runId || !state.slug || !Number.isInteger(state.revision)) {
    throw new OrchestrationStateError("INVALID_STATE", "state.json is missing run identity fields");
  }
  if (!RUN_STATUS_SET.has(state.status)) {
    throw new OrchestrationStateError(
      "INVALID_RUN_STATUS",
      `Run ${state.runId} has invalid status ${state.status}`,
    );
  }
  if (!PHASE_STATUS_SET.has(state.phaseStatus)) {
    throw new OrchestrationStateError(
      "INVALID_PHASE_STATUS",
      `Run ${state.runId} has invalid phase status ${state.phaseStatus}`,
    );
  }
  for (const [taskId, task] of Object.entries(state.tasks ?? {})) {
    validateTask(taskId, task);
  }
  validateCompletionGates(state.completionGates);
  return state;
}

function reduceEvent(previousState, event) {
  let state = previousState == null ? null : clone(previousState);
  const payload = event.payload ?? {};

  switch (event.type) {
    case "RUN_INITIALIZED":
      if (state != null) {
        throw new OrchestrationStateError("DUPLICATE_INIT", "Run is already initialized");
      }
      state = clone(payload.state);
      break;
    case "TASKS_SYNCED":
      state.tasks = clone(payload.tasks);
      state.waves = clone(payload.waves);
      state.currentWave = payload.currentWave;
      state.sync = clone(payload.sync);
      if (payload.completionGates) state.completionGates = clone(payload.completionGates);
      break;
    case "PHASE_UPDATED":
      state.phase = payload.phase;
      state.phaseStatus = payload.phaseStatus;
      state.lastSafePhase = payload.lastSafePhase;
      state.phaseHistory = clone(payload.phaseHistory);
      state.status = payload.runStatus;
      if (payload.completionGates) state.completionGates = clone(payload.completionGates);
      break;
    case "TASK_UPDATED":
    case "TASK_HEARTBEAT":
      state.tasks[payload.taskId] = clone(payload.task);
      state.status = payload.runStatus;
      state.currentWave = payload.currentWave;
      break;
    case "STALL_SWEEP_COMPLETED":
      state.tasks = clone(payload.tasks);
      state.status = payload.runStatus;
      state.currentWave = payload.currentWave;
      state.lifecycle = clone(payload.lifecycle);
      break;
    case "RUN_RESUMED":
      state.tasks = clone(payload.tasks);
      state.status = payload.runStatus;
      state.currentWave = payload.currentWave;
      state.resume = clone(payload.resume);
      break;
    case "RUN_RECONCILED":
      state.tasks = clone(payload.tasks);
      state.status = payload.runStatus;
      state.currentWave = payload.currentWave;
      state.repository = clone(payload.repository);
      state.resume = clone(payload.resume);
      break;
    case "RUN_STATUS_UPDATED":
      state.status = payload.runStatus;
      state.statusReason = payload.statusReason ?? null;
      if (payload.cancellation) state.cancellation = clone(payload.cancellation);
      break;
    case "COMPLETION_GATE_UPDATED":
      state.completionGates = clone(payload.completionGates);
      state.status = payload.runStatus;
      break;
    case "TASK_SCOPE_RESOLVED":
    case "TASK_LEASE_UPDATED":
    case "TASK_WORKSPACE_UPDATED":
      state.tasks[payload.taskId] = clone(payload.task);
      state.status = payload.runStatus;
      state.currentWave = payload.currentWave;
      if (payload.sync) state.sync = clone(payload.sync);
      break;
    case "RUN_CANCELLATION_REQUESTED":
      state.tasks = clone(payload.tasks);
      state.status = payload.runStatus;
      state.currentWave = payload.currentWave;
      state.cancellation = clone(payload.cancellation);
      state.resume = clone(payload.resume);
      break;
    default:
      throw new OrchestrationStateError(
        "UNKNOWN_EVENT_TYPE",
        `Unknown orchestration event type: ${event.type}`,
      );
  }

  state.revision = event.revision;
  state.lastEventId = event.eventId;
  state.updatedAt = event.occurredAt;
  validateState(state);
  return state;
}

function replayEvents(events) {
  let state = null;
  for (const event of events) state = reduceEvent(state, event);
  return state;
}

function loadSnapshot(artifactDir) {
  const path = stateFile(artifactDir);
  if (!existsSync(path)) return { state: null, error: null };
  try {
    return { state: safeJsonParse(readFileSync(path, "utf8"), path), error: null };
  } catch (error) {
    return { state: null, error };
  }
}

export function loadRun(artifactDir, options = {}) {
  const directory = resolve(artifactDir);
  const eventLogPath = eventsFile(directory);
  const eventTailRecovered = options.repairSnapshot
    ? repairIncompleteEventTail(eventLogPath)
    : false;
  const snapshot = loadSnapshot(directory);
  const eventRead = readEvents(directory);
  const events = eventRead.events;

  if (snapshot.state == null && events.length === 0) {
    if (snapshot.error) throw snapshot.error;
    throw new OrchestrationStateError(
      "RUN_NOT_FOUND",
      `No state.json or events.jsonl found in ${directory}`,
    );
  }

  let state = snapshot.state;
  let snapshotError = snapshot.error;
  let snapshotRecovered = snapshot.error != null || state == null;
  let startRevision = 0;

  if (state != null) {
    try {
      validateState(state);
      startRevision = state.revision;
    } catch (error) {
      if (events.length === 0) throw error;
      snapshotError = error;
      snapshotRecovered = true;
      state = null;
    }
  }

  const seenRevisions = new Set();
  let maximumEventRevision = 0;
  let eventRunId = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (seenRevisions.has(event.revision)) {
      throw new OrchestrationStateError(
        "DUPLICATE_EVENT_REVISION",
        `events.jsonl contains revision ${event.revision} more than once`,
      );
    }
    const expectedRevision = index + 1;
    if (event.revision !== expectedRevision) {
      throw new OrchestrationStateError(
        "EVENT_REVISION_GAP",
        `Expected event revision ${expectedRevision}, found ${event.revision}`,
      );
    }
    seenRevisions.add(event.revision);
    maximumEventRevision = Math.max(maximumEventRevision, event.revision);
    eventRunId ??= event.runId;
    if (event.runId !== eventRunId) {
      throw new OrchestrationStateError(
        "RUN_ID_MISMATCH",
        `Event ${event.eventId} belongs to another run`,
      );
    }
    if (index === 0 && event.type !== "RUN_INITIALIZED") {
      throw new OrchestrationStateError(
        "MISSING_INIT_EVENT",
        "events.jsonl must begin with RUN_INITIALIZED",
      );
    }
  }

  if (state != null && state.revision > maximumEventRevision) {
    throw new OrchestrationStateError(
      "SNAPSHOT_AHEAD_OF_LOG",
      `state.json revision ${state.revision} is ahead of events.jsonl revision ${maximumEventRevision}`,
    );
  }

  if (state == null) {
    state = replayEvents(events);
  } else {
    const pending = events.filter((event) => event.revision > startRevision);
    for (let index = 0; index < pending.length; index += 1) {
      const expected = startRevision + index + 1;
      if (pending[index].revision !== expected) {
        throw new OrchestrationStateError(
          "EVENT_REVISION_GAP",
          `Expected event revision ${expected}, found ${pending[index].revision}`,
        );
      }
      if (pending[index].runId !== state.runId) {
        throw new OrchestrationStateError(
          "RUN_ID_MISMATCH",
          `Event ${pending[index].eventId} belongs to another run`,
        );
      }
      state = reduceEvent(state, pending[index]);
      snapshotRecovered = true;
    }
  }

  let snapshotDiverged = false;
  if (options.verifyReplay) {
    const replayed = replayEvents(events);
    if (!isDeepStrictEqual(state, replayed)) {
      state = replayed;
      snapshotRecovered = true;
      snapshotDiverged = true;
    }
  }

  if (options.repairSnapshot && snapshotRecovered) {
    writeSnapshotAtomically(stateFile(directory), state);
  }

  return {
    artifactDir: directory,
    state,
    events,
    snapshotRecovered,
    snapshotError: snapshotError?.message ?? null,
    eventTailRecovered,
    eventTailIncomplete: eventRead.truncatedTail,
    snapshotDiverged,
  };
}

function commitEvent(artifactDir, currentState, type, payload, options = {}) {
  const directory = resolve(artifactDir);
  const occurredAt = iso(options.now);
  const event = {
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    eventId: randomUUID(),
    runId: currentState?.runId ?? payload?.state?.runId,
    revision: (currentState?.revision ?? 0) + 1,
    occurredAt,
    type,
    actor: options.actor ?? "orchestrator",
    payload: clone(payload),
  };

  const nextState = reduceEvent(currentState, event);
  // Write-ahead invariant borrowed from Hermes async delegation: durable result
  // first, snapshot/publication second. A crash in between is repaired by replay.
  appendEventDurably(eventsFile(directory), event);
  writeSnapshotAtomically(stateFile(directory), nextState);
  return { state: nextState, event };
}

function runGit(projectRoot, args, options = {}) {
  try {
    const output = execFileSync("git", args, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout ?? 10_000,
    });
    return options.preserveLeadingWhitespace ? output.trimEnd() : output.trim();
  } catch (error) {
    if (options.allowFailure) return null;
    throw error;
  }
}

export function inspectGit(projectRoot) {
  const root = resolve(projectRoot);
  const gitRoot = runGit(root, ["rev-parse", "--show-toplevel"], { allowFailure: true });
  if (!gitRoot) {
    return {
      available: false,
      observedAt: new Date().toISOString(),
      error: "not-a-git-repository",
    };
  }

  const head = runGit(root, ["rev-parse", "HEAD"], { allowFailure: true });
  const branch = runGit(root, ["branch", "--show-current"], { allowFailure: true });
  const porcelain = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all"], {
    allowFailure: true,
    preserveLeadingWhitespace: true,
  });
  const changedFiles = (porcelain ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((path) => path.includes(" -> ") ? path.split(" -> ").at(-1) : path);

  return {
    available: true,
    root: toPosix(relative(root, resolve(gitRoot)) || "."),
    head,
    branch: branch || null,
    dirty: changedFiles.length > 0,
    changedFiles: [...new Set(changedFiles)].sort(),
    observedAt: new Date().toISOString(),
  };
}

function changedFilesSince(projectRoot, commitBefore, currentGit) {
  const files = new Set(currentGit.changedFiles ?? []);
  if (commitBefore && currentGit.available && currentGit.head && commitBefore !== currentGit.head) {
    const committed = runGit(
      projectRoot,
      ["diff", "--name-only", `${commitBefore}..${currentGit.head}`],
      { allowFailure: true },
    );
    for (const path of (committed ?? "").split(/\r?\n/).filter(Boolean)) files.add(path.trim());
  }
  return [...files].sort();
}

function phaseName(phase) {
  return PHASE_NAMES[phase] ?? `phase-${phase}`;
}

function nextSafeResumePhase(lastSafePhase) {
  const completed = Number(lastSafePhase ?? 0);
  return PHASE_SEQUENCE.find((phase) => phase > completed) ?? PHASE_SEQUENCE.at(-1);
}

function normalizeSlug(value) {
  const slug = String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  if (!slug) {
    throw new OrchestrationStateError("INVALID_SLUG", "A non-empty slug is required");
  }
  return slug;
}

function nextRunId(projectRoot, slug, now = new Date()) {
  const date = asDate(now);
  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
  const prefix = `${slug}-${stamp}-`;
  const orchestrationRoot = join(resolve(projectRoot), ".orchestration");
  let maximum = 0;

  if (existsSync(orchestrationRoot)) {
    for (const entry of readdirSync(orchestrationRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(orchestrationRoot, entry.name, "state.json");
      if (!existsSync(path)) continue;
      try {
        const candidate = JSON.parse(readFileSync(path, "utf8"));
        if (String(candidate.runId ?? "").startsWith(prefix)) {
          maximum = Math.max(maximum, Number(candidate.runId.slice(prefix.length)) || 0);
        }
      } catch {
        // A damaged unrelated run must not block initialization of this one.
      }
    }
  }

  return `${prefix}${String(maximum + 1).padStart(3, "0")}`;
}

function uniqueTaskIds(text) {
  return [...new Set((text.match(TASK_ID_RE) ?? []).map((id) => id.toUpperCase()))];
}

function extractTaskBlocks(content) {
  const lines = content.split(/\r?\n/);
  const blocks = [];
  let current = null;

  const pushCurrent = () => {
    if (current) blocks.push({ id: current.id, text: current.lines.join("\n") });
    current = null;
  };

  for (const line of lines) {
    const ids = uniqueTaskIds(line);
    if (ids.length === 0) {
      if (current) current.lines.push(line);
      continue;
    }

    if (/^\s*\|/.test(line)) {
      blocks.push({ id: ids[0], text: line });
      continue;
    }

    if (/^#{1,6}\s+/.test(line) || /\b(?:ID|Task)\b\s*[:#-]?/i.test(line)) {
      pushCurrent();
      current = { id: ids[0], lines: [line] };
      continue;
    }

    if (current) current.lines.push(line);
  }
  pushCurrent();

  if (blocks.length === 0) {
    return uniqueTaskIds(content).map((id) => ({ id, text: id }));
  }
  return blocks;
}

function detectExecutor(text) {
  const codex = /\b(?:codex:codex-rescue|codex)\b/i.test(text);
  const agy = /\b(?:cc-antigravity-plugin:antigravity-coder|antigravity|agy)\b/i.test(text);
  if (codex && agy) return "codex+agy";
  if (codex) return "codex";
  if (agy) return "agy";
  return null;
}

function blockTitle(block) {
  const first = block.text.split(/\r?\n/)[0] ?? block.id;
  if (/^\s*\|/.test(first)) {
    const cells = first.split("|").map((cell) => cell.trim()).filter(Boolean);
    return cells.find((cell) => cell.toUpperCase() !== block.id) ?? block.id;
  }
  return first
    .replace(/^#{1,6}\s+/, "")
    .replace(new RegExp(`\\b${block.id}\\b`, "i"), "")
    .replace(/^\s*[-:|]+\s*/, "")
    .trim() || block.id;
}

function parseExpectedFiles(text) {
  const lines = text.split(/\r?\n/).filter((line) =>
    /(?:expectedFiles|producedFiles|arquivos esperados|arquivos produzidos)/i.test(line),
  );
  const paths = [];
  for (const line of lines) {
    for (const match of line.matchAll(/`([^`]+)`/g)) paths.push(match[1]);
  }
  return [...new Set(paths)];
}

function parseBacktickValues(text, pattern) {
  const values = [];
  for (const line of text.split(/\r?\n/).filter((entry) => pattern.test(entry))) {
    for (const match of line.matchAll(/`([^`]+)`/g)) values.push(match[1].trim());
  }
  return [...new Set(values.filter(Boolean))];
}

function parseScalarField(text, names) {
  const matcher = new RegExp(`(?:${names.join("|")})\\s*[:=]\\s*([^\\n|]+)`, "i");
  const match = text.match(matcher);
  return match?.[1]?.replace(/[`*_]/g, "").trim() ?? null;
}

function parseTaskPlanningMetadata(text) {
  const complexityRaw = parseScalarField(text, ["complexity", "complexidade"]);
  const complexity = complexityRaw
    ? ({ low: "low", baixa: "low", medium: "medium", media: "medium", média: "medium", high: "high", alta: "high", critical: "critical", critica: "critical", crítica: "critical" }[
        complexityRaw.toLowerCase()
      ] ?? complexityRaw.toLowerCase())
    : null;
  const contractRaw = parseScalarField(text, ["contractRequired", "contrato obrigatorio", "contrato obrigatório"]);
  const contractRequired = contractRaw == null
    ? null
    : /^(?:yes|sim|true|required|obrigatorio|obrigatório)$/i.test(contractRaw);
  const model = parseScalarField(text, ["agyModel", "model", "modelo"]);
  return {
    complexity,
    contractRequired,
    model,
    validationPlan: parseBacktickValues(
      text,
      /(?:validationPlan|validation command|comando de validacao|comando de validação|validacoes|validações)/i,
    ),
    allowedPaths: parseBacktickValues(
      text,
      /(?:allowedPaths|allowed paths|caminhos permitidos|task scope|escopo da task)/i,
    ),
    contractIds: parseBacktickValues(text, /(?:contractIds?|contratos?)/i),
  };
}

export function parseTaskArtifacts(artifactDir) {
  const directory = resolve(artifactDir);
  const classificationSource = resolveArtifact(directory, "tasks-classification.md");
  const wavesSource = resolveArtifact(directory, "waves.md");
  const classification = classificationSource
    ? readFileSync(classificationSource.path, "utf8")
    : "";
  const wavesText = wavesSource ? readFileSync(wavesSource.path, "utf8") : "";
  const taskBlocks = extractTaskBlocks(classification);
  const tasks = {};

  for (const block of taskBlocks) {
    const category = CATEGORY_VALUES.find((value) =>
      new RegExp(`\\b${value}\\b`, "i").test(block.text),
    ) ?? null;
    tasks[block.id] = {
      id: block.id,
      title: blockTitle(block),
      category,
      executor: detectExecutor(block.text),
      expectedFiles: parseExpectedFiles(block.text),
      classificationPresent: true,
      ...parseTaskPlanningMetadata(block.text),
    };
  }

  const waves = [];
  let current = null;
  for (const line of wavesText.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(?:Wave|Onda)\s+([0-9]+)\b/i);
    if (heading) {
      current = { id: Number(heading[1]), tasks: [] };
      waves.push(current);
    }
    const ids = uniqueTaskIds(line);
    if (ids.length === 0) continue;
    if (!current) {
      current = { id: 1, tasks: [] };
      waves.push(current);
    }
    for (const taskId of ids) {
      if (!current.tasks.includes(taskId)) current.tasks.push(taskId);
      if (!tasks[taskId]) {
        tasks[taskId] = {
          id: taskId,
          title: taskId,
          category: null,
          executor: detectExecutor(line),
          expectedFiles: [],
          classificationPresent: false,
          complexity: null,
          contractRequired: null,
          model: null,
          validationPlan: [],
          allowedPaths: [],
          contractIds: [],
        };
      }
    }
  }

  if (waves.length === 0 && Object.keys(tasks).length > 0) {
    waves.push({ id: 1, tasks: Object.keys(tasks) });
  }

  const waveByTask = new Map();
  for (const wave of waves) {
    for (const taskId of wave.tasks) {
      if (!waveByTask.has(taskId)) waveByTask.set(taskId, wave.id);
    }
  }
  for (const task of Object.values(tasks)) task.wave = waveByTask.get(task.id) ?? null;

  return {
    tasks,
    waves,
    sources: {
      classification: classificationSource?.relativePath ?? null,
      waves: wavesSource?.relativePath ?? null,
    },
  };
}

function initialTask(metadata, now) {
  return {
    ...clone(metadata),
    status: "PENDING",
    attempt: 0,
    attemptHistory: [],
    sessionId: null,
    conversationId: null,
    commitBefore: null,
    commitAfter: null,
    startedAt: null,
    completedAt: null,
    lastActivityAt: null,
    apiCalls: 0,
    toolCalls: 0,
    currentTool: null,
    inTool: false,
    producedFiles: [],
    validations: [],
    evidence: [],
    reasonCode: null,
    reason: null,
    reconciliation: null,
    sourcePresent: metadata.classificationPresent !== false,
    scopeResolution: null,
    lease: null,
    workspace: null,
    createdAt: now,
    updatedAt: now,
  };
}

function taskCategoryFlags(tasks) {
  const values = Object.values(tasks ?? {}).filter((task) => task.sourcePresent !== false);
  const backend = values.some((task) =>
    ["BACKEND_ONLY", "FULLSTACK", "DATABASE_ONLY"].includes(task.category),
  );
  const frontend = values.some((task) =>
    ["FRONTEND_ONLY", "FULLSTACK"].includes(task.category),
  );
  return { backend, frontend };
}

function completionGateRequirements(tasks) {
  const { backend, frontend } = taskCategoryFlags(tasks);
  return {
    backendReview: backend,
    frontendReview: frontend,
    // Todo front-end exige verificacao em navegador real. A parte mecanicamente decidivel
    // aqui e apenas "existe front-end"; se a topologia nao tiver origens separadas, a
    // dispensa e uma decisao arquitetural que precisa ficar registrada como waiver com
    // motivo (gate --gate browserE2E --status N/A --required false --reason ...), nunca
    // uma derivacao silenciosa por categoria de task.
    browserE2E: frontend,
    reports: true,
    handoff: true,
    delivery: true,
    learning: true,
  };
}

function synchronizeCompletionGates(previous, tasks, now) {
  const requirements = completionGateRequirements(tasks);
  const gates = {};
  for (const [gateId, definition] of Object.entries(COMPLETION_GATE_DEFINITIONS)) {
    const existing = previous?.[gateId] ?? null;
    const requiredOverride = definition.waivable
      ? existing?.requiredOverride ?? null
      : null;
    const required = requiredOverride == null ? requirements[gateId] : requiredOverride;
    let status = existing?.status ?? (required ? "PENDING" : "N/A");
    if (!required && ["PENDING", "RUNNING", "BLOCKED", "FAILED"].includes(status)) {
      status = "N/A";
    }
    if (required && status === "N/A") status = "PENDING";
    gates[gateId] = {
      id: gateId,
      label: definition.label,
      phase: definition.phase,
      required,
      requiredOverride,
      status,
      evidence: clone(existing?.evidence ?? []),
      reason: existing?.reason ?? null,
      startedAt: existing?.startedAt ?? null,
      completedAt: existing?.completedAt ?? null,
      updatedAt: existing?.updatedAt ?? now,
    };
  }
  return gates;
}

function completionGateForPhase(phase) {
  return Object.entries(COMPLETION_GATE_DEFINITIONS)
    .filter(([, definition]) => definition.phase === phase)
    .map(([gateId]) => gateId);
}

function completionGateSummary(gates) {
  return Object.fromEntries(
    Object.entries(gates ?? {}).map(([gateId, gate]) => [gateId, gate.status]),
  );
}

function computeCurrentWave(state) {
  for (const wave of state.waves ?? []) {
    if (
      wave.tasks.some((taskId) => {
        const status = state.tasks?.[taskId]?.status;
        return status && !TERMINAL_TASK_STATUSES.has(status);
      })
    ) {
      return wave.id;
    }
  }
  return state.waves?.at(-1)?.id ?? null;
}

function deriveRunStatus(tasks, fallback = "RUNNING") {
  const values = Object.values(tasks ?? {});
  if (values.length === 0) return fallback;
  for (const status of ["RUNNING", "STALLED", "UNKNOWN", "BLOCKED", "FAILED"] ) {
    if (values.some((task) => task.status === status)) return status;
  }
  // Task aggregation must never close a run. Cancellation and successful
  // completion are explicit run-level protocols with their own gates.
  if (values.every((task) => TERMINAL_TASK_STATUSES.has(task.status))) return fallback;
  if (TERMINAL_RUN_STATUSES.has(fallback)) return fallback;
  return "RUNNING";
}

function runSummary(state) {
  const counts = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0]));
  for (const task of Object.values(state.tasks ?? {})) counts[task.status] += 1;
  return {
    runId: state.runId,
    slug: state.slug,
    status: state.status,
    phase: state.phase,
    phaseStatus: state.phaseStatus,
    lastSafePhase: state.lastSafePhase,
    currentWave: state.currentWave,
    revision: state.revision,
    counts,
    gates: completionGateSummary(state.completionGates),
    updatedAt: state.updatedAt,
  };
}

export function initRun(options) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const slug = normalizeSlug(options.slug ?? basename(resolve(options.artifactDir ?? "")));
  const artifactDir = resolve(options.artifactDir ?? join(projectRoot, ".orchestration", slug));

  return withLock(artifactDir, () => {
    if (existsSync(stateFile(artifactDir)) || existsSync(eventsFile(artifactDir))) {
      const loaded = loadRun(artifactDir, { repairSnapshot: true });
      if (TERMINAL_RUN_STATUSES.has(loaded.state.status)) {
        throw new OrchestrationStateError(
          "RUN_TERMINAL",
          `Run ${loaded.state.runId} is already ${loaded.state.status}; initialize a new slug/run identity`,
        );
      }
      return { created: false, artifactDir, state: loaded.state, summary: runSummary(loaded.state) };
    }

    const now = iso(options.now);
    const phase = Number(options.phase ?? 1);
    const git = inspectGit(projectRoot);
    const layoutVersion = SUPPORTED_ARTIFACT_LAYOUT_VERSIONS.includes(Number(options.layoutVersion))
      ? Number(options.layoutVersion)
      : ARTIFACT_LAYOUT_VERSION;
    ensureArtifactLayout(artifactDir, layoutVersion);
    const parsed = parseTaskArtifacts(artifactDir);
    const tasks = Object.fromEntries(
      Object.entries(parsed.tasks).map(([taskId, metadata]) => [taskId, initialTask(metadata, now)]),
    );
    const runId = options.runId ?? nextRunId(projectRoot, slug, asDate(options.now));
    const currentWave = parsed.waves[0]?.id ?? null;
    const initial = {
      schemaVersion: STATE_SCHEMA_VERSION,
      layoutVersion,
      runId,
      slug,
      artifactRoot: toPosix(relative(projectRoot, artifactDir) || "."),
      status: "RUNNING",
      statusReason: null,
      phase,
      phaseStatus: "RUNNING",
      lastSafePhase: Math.max(0, Number(options.lastSafePhase ?? phase - 1)),
      currentWave,
      tasks,
      waves: parsed.waves,
      completionGates: synchronizeCompletionGates(null, tasks, now),
      phaseHistory: {
        [String(phase)]: {
          name: phaseName(phase),
          status: "RUNNING",
          startedAt: now,
          completedAt: null,
        },
      },
      repository: {
        ...git,
        headAtStart: git.head ?? null,
        dirtyAtStart: git.dirty ?? null,
        lastObservedHead: git.head ?? null,
      },
      sync: {
        lastSyncedAt: now,
        sources: parsed.sources,
        missingFromSource: [],
      },
      lifecycle: {
        staleIdleSeconds: Number(options.staleIdleSeconds ?? 450),
        staleInToolSeconds: Number(options.staleInToolSeconds ?? 1200),
        stallGraceSeconds: Number(options.stallGraceSeconds ?? 120),
        lastSweepAt: null,
      },
      resume: {
        count: 0,
        lastResumedAt: null,
        lastReconciledAt: null,
        resumeFromPhase: phase,
        pendingExternalProbes: [],
        recommendations: [],
      },
      cancellation: {
        requestedAt: null,
        requestedBy: null,
        reason: null,
        pendingExecutorStops: [],
        finalizedAt: null,
      },
      createdAt: now,
      updatedAt: now,
      revision: 0,
      lastEventId: null,
    };

    const committed = commitEvent(
      artifactDir,
      null,
      "RUN_INITIALIZED",
      { state: initial },
      options,
    );
    return {
      created: true,
      artifactDir,
      state: committed.state,
      event: committed.event,
      summary: runSummary(committed.state),
    };
  }, options);
}

export function syncRunFromArtifacts(artifactDir, options = {}) {
  return withLock(artifactDir, () => {
    const loaded = loadRun(artifactDir, { repairSnapshot: true });
    const state = loaded.state;
    assertRunMutable(state, "synchronize task artifacts");
    const parsed = parseTaskArtifacts(artifactDir);
    const now = iso(options.now);
    const nextTasks = {};
    const missingFromSource = [];

    for (const [taskId, metadata] of Object.entries(parsed.tasks)) {
      const previous = state.tasks[taskId];
      const sourcePresent = metadata.classificationPresent !== false;
      if (!sourcePresent) missingFromSource.push(taskId);
      nextTasks[taskId] = previous
        ? {
            ...previous,
            ...clone(metadata),
            expectedFiles: metadata.expectedFiles.length > 0
              ? metadata.expectedFiles
              : previous.expectedFiles ?? [],
            validationPlan: metadata.validationPlan.length > 0
              ? metadata.validationPlan
              : previous.validationPlan ?? [],
            allowedPaths: metadata.allowedPaths.length > 0
              ? metadata.allowedPaths
              : previous.allowedPaths ?? [],
            contractIds: metadata.contractIds.length > 0
              ? metadata.contractIds
              : previous.contractIds ?? [],
            sourcePresent,
            scopeResolution: previous.sourcePresent === false && sourcePresent
              ? {
                  ...(previous.scopeResolution ?? {}),
                  reinstatedAt: now,
                  status: "REINSTATED",
                }
              : previous.scopeResolution ?? null,
            updatedAt: now,
          }
        : initialTask(metadata, now);
    }

    for (const [taskId, previous] of Object.entries(state.tasks)) {
      if (nextTasks[taskId]) continue;
      missingFromSource.push(taskId);
      nextTasks[taskId] = { ...previous, sourcePresent: false, updatedAt: now };
    }

    const draft = { ...state, tasks: nextTasks, waves: parsed.waves };
    const currentWave = computeCurrentWave(draft);
    const sync = {
      lastSyncedAt: now,
      sources: parsed.sources,
      missingFromSource,
    };
    const completionGates = synchronizeCompletionGates(
      state.completionGates,
      nextTasks,
      now,
    );
    const committed = commitEvent(
      artifactDir,
      state,
      "TASKS_SYNCED",
      { tasks: nextTasks, waves: parsed.waves, currentWave, sync, completionGates },
      options,
    );
    return {
      artifactDir: resolve(artifactDir),
      state: committed.state,
      event: committed.event,
      summary: runSummary(committed.state),
      missingFromSource,
    };
  }, options);
}

export function updatePhase(artifactDir, phase, phaseStatus, options = {}) {
  const numericPhase = Number(phase);
  const normalizedStatus = String(phaseStatus).toUpperCase();
  if (!Number.isFinite(numericPhase)) {
    throw new OrchestrationStateError("INVALID_PHASE", `Invalid phase: ${phase}`);
  }
  if (!PHASE_STATUS_SET.has(normalizedStatus)) {
    throw new OrchestrationStateError(
      "INVALID_PHASE_STATUS",
      `Invalid phase status: ${phaseStatus}`,
    );
  }

  return withLock(artifactDir, () => {
    const state = loadRun(artifactDir, { repairSnapshot: true }).state;
    assertRunMutable(state, "update a phase");
    const now = iso(options.now);
    const history = clone(state.phaseHistory ?? {});
    const previous = history[String(numericPhase)] ?? {};
    history[String(numericPhase)] = {
      name: phaseName(numericPhase),
      status: normalizedStatus,
      startedAt: previous.startedAt ?? now,
      completedAt: normalizedStatus === "DONE" ? now : previous.completedAt ?? null,
      reason: options.reason ?? previous.reason ?? null,
    };

    const lastSafePhase = normalizedStatus === "DONE"
      ? Math.max(Number(state.lastSafePhase ?? 0), numericPhase)
      : Number(state.lastSafePhase ?? 0);
    let runStatus = state.status;
    if (normalizedStatus === "RUNNING" || normalizedStatus === "DONE") runStatus = "RUNNING";
    if (["FAILED", "BLOCKED", "UNKNOWN"].includes(normalizedStatus)) runStatus = normalizedStatus;
    // A cancelled phase is a workflow blocker, not permission to terminally
    // cancel a run while executors may still be active. Use requestRunCancellation.
    if (normalizedStatus === "CANCELLED") runStatus = "BLOCKED";
    assertRunTransition(state, runStatus);

    const completionGates = synchronizeCompletionGates(
      state.completionGates,
      state.tasks,
      now,
    );
    for (const gateId of completionGateForPhase(numericPhase)) {
      const previousGate = completionGates[gateId];
      if (!previousGate.required && previousGate.status === "N/A") continue;
      const gateStatus = normalizedStatus === "DONE"
        ? "DONE"
        : normalizedStatus === "RUNNING"
          ? "RUNNING"
          : normalizedStatus === "FAILED"
            ? "FAILED"
            : "BLOCKED";
      completionGates[gateId] = {
        ...previousGate,
        status: gateStatus,
        startedAt: previousGate.startedAt ?? now,
        completedAt: gateStatus === "DONE" ? now : null,
        reason: options.reason ?? previousGate.reason ?? null,
        evidence: [
          ...new Set([
            ...(previousGate.evidence ?? []),
            ...(normalizeList(options.evidence) ?? []),
          ]),
        ],
        updatedAt: now,
      };
    }
    const committed = commitEvent(
      artifactDir,
      state,
      "PHASE_UPDATED",
      {
        phase: numericPhase,
        phaseStatus: normalizedStatus,
        lastSafePhase,
        phaseHistory: history,
        runStatus,
        completionGates,
      },
      options,
    );
    return { state: committed.state, event: committed.event, summary: runSummary(committed.state) };
  }, options);
}

const GATE_ARTIFACT_CANDIDATES = Object.freeze({
  backendReview: [["review-final.md"]],
  frontendReview: [["review-frontend.md"]],
  browserE2E: [["browser-e2e-report.md"], ["e2e-report.md"], ["e2e-verification.md"]],
  reports: [["workflow-log.md", "subagents-context.md", "implementation-report.md"]],
  handoff: [["handoff.json"]],
  delivery: [],
  learning: [["learning-report.md"]],
});

function gateArtifactEvidence(artifactDir, gateId) {
  const alternatives = GATE_ARTIFACT_CANDIDATES[gateId] ?? [];
  for (const group of alternatives) {
    const checked = group.map((name) => {
      const resolved = resolveArtifact(artifactDir, name);
      return { path: resolved?.relativePath ?? name, exists: resolved != null };
    });
    if (checked.length > 0 && checked.every((entry) => entry.exists)) return checked;
  }
  return [];
}

export function updateCompletionGate(artifactDir, gateId, status, options = {}) {
  const normalizedGateId = String(gateId ?? "").trim();
  const normalizedStatus = String(status ?? "").toUpperCase();
  if (!COMPLETION_GATE_DEFINITIONS[normalizedGateId]) {
    throw new OrchestrationStateError(
      "UNKNOWN_COMPLETION_GATE",
      `Unknown completion gate: ${gateId}`,
    );
  }
  if (!GATE_STATUS_SET.has(normalizedStatus)) {
    throw new OrchestrationStateError(
      "INVALID_GATE_STATUS",
      `Invalid completion gate status: ${status}`,
    );
  }

  return withLock(artifactDir, () => {
    const state = loadRun(artifactDir, { repairSnapshot: true }).state;
    assertRunMutable(state, "update a completion gate");
    const now = iso(options.now);
    const completionGates = synchronizeCompletionGates(
      state.completionGates,
      state.tasks,
      now,
    );
    const definition = COMPLETION_GATE_DEFINITIONS[normalizedGateId];
    const previous = completionGates[normalizedGateId];
    if (options.required != null && typeof options.required !== "boolean") {
      throw new OrchestrationStateError(
        "INVALID_GATE_APPLICABILITY",
        "Completion gate required override must be a boolean",
      );
    }
    if (options.required != null && !definition.waivable) {
      throw new OrchestrationStateError(
        "GATE_APPLICABILITY_FIXED",
        `Completion gate ${normalizedGateId} derives applicability from task categories`,
      );
    }
    if (normalizedStatus === "N/A" && !options.reason) {
      throw new OrchestrationStateError(
        "GATE_WAIVER_REQUIRES_REASON",
        `Completion gate ${normalizedGateId} requires a reason when marked N/A`,
      );
    }
    let requiredOverride = options.required ?? previous.requiredOverride ?? null;
    if (normalizedStatus === "N/A" && previous.required && definition.waivable) {
      requiredOverride = false;
    }
    if (normalizedStatus === "N/A" && previous.required && !definition.waivable) {
      throw new OrchestrationStateError(
        "REQUIRED_GATE_CANNOT_BE_SKIPPED",
        `Completion gate ${normalizedGateId} is required and cannot be N/A`,
      );
    }
    const required = requiredOverride == null ? previous.required : requiredOverride;
    if (normalizedStatus === "N/A" && required) {
      throw new OrchestrationStateError(
        "REQUIRED_GATE_CANNOT_BE_SKIPPED",
        `Completion gate ${normalizedGateId} is required and cannot be N/A`,
      );
    }

    const explicitEvidence = normalizeList(options.evidence) ?? [];
    const artifactEvidence = gateArtifactEvidence(artifactDir, normalizedGateId);
    const evidence = [
      ...new Set([
        ...(previous.evidence ?? []),
        ...explicitEvidence,
        ...artifactEvidence.map((entry) => `file:${entry.path}`),
      ]),
    ];
    if (normalizedStatus === "DONE" && evidence.length === 0) {
      throw new OrchestrationStateError(
        "GATE_DONE_REQUIRES_EVIDENCE",
        `Completion gate ${normalizedGateId} cannot be DONE without evidence`,
      );
    }

    completionGates[normalizedGateId] = {
      ...previous,
      required,
      requiredOverride,
      status: normalizedStatus,
      startedAt: previous.startedAt ?? (normalizedStatus === "PENDING" ? null : now),
      completedAt: ["DONE", "N/A"].includes(normalizedStatus) ? now : null,
      reason: options.reason ?? previous.reason ?? null,
      evidence,
      updatedAt: now,
    };
    let runStatus = state.status;
    if (normalizedStatus === "FAILED") runStatus = "FAILED";
    else if (normalizedStatus === "BLOCKED") runStatus = "BLOCKED";
    else if (["RUNNING", "DONE", "N/A"].includes(normalizedStatus)) runStatus = "RUNNING";
    assertRunTransition(state, runStatus);
    const committed = commitEvent(
      artifactDir,
      state,
      "COMPLETION_GATE_UPDATED",
      { gateId: normalizedGateId, completionGates, runStatus },
      options,
    );
    return {
      state: committed.state,
      event: committed.event,
      gate: committed.state.completionGates[normalizedGateId],
      summary: runSummary(committed.state),
    };
  }, options);
}

function ensureTask(state, taskId) {
  const normalized = String(taskId ?? "").toUpperCase();
  if (!TASK_ID_EXACT_RE.test(normalized) || !state.tasks[normalized]) {
    throw new OrchestrationStateError("TASK_NOT_FOUND", `Task not found: ${taskId}`);
  }
  return normalized;
}

function normalizeList(value) {
  if (value == null) return undefined;
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

function mergeTaskFields(previous, status, options, now, git) {
  const task = clone(previous);
  const previousStatus = task.status;
  const sameStatus = previousStatus === status;
  if (!sameStatus && !TASK_TRANSITIONS[previousStatus]?.has(status)) {
    throw new OrchestrationStateError(
      "INVALID_TASK_TRANSITION",
      `Task ${task.id} cannot transition from ${previousStatus} to ${status}`,
    );
  }

  task.status = status;
  task.updatedAt = now;
  if (options.executor !== undefined) task.executor = options.executor;
  if (options.model !== undefined) task.model = options.model || null;
  if (options.complexity !== undefined) task.complexity = options.complexity || null;
  if (options.sessionId !== undefined) task.sessionId = options.sessionId || null;
  if (options.conversationId !== undefined) task.conversationId = options.conversationId || null;
  if (options.reasonCode !== undefined) task.reasonCode = options.reasonCode || null;
  if (options.reason !== undefined) task.reason = options.reason || null;
  if (options.currentTool !== undefined) task.currentTool = options.currentTool || null;
  if (options.inTool !== undefined) task.inTool = Boolean(options.inTool);
  if (options.apiCalls !== undefined) task.apiCalls = Number(options.apiCalls);
  if (options.toolCalls !== undefined) task.toolCalls = Number(options.toolCalls);

  const expectedFiles = normalizeList(options.expectedFiles);
  if (expectedFiles) task.expectedFiles = expectedFiles;
  const producedFiles = normalizeList(options.producedFiles);
  if (producedFiles) task.producedFiles = [...new Set([...(task.producedFiles ?? []), ...producedFiles])];
  const evidence = normalizeList(options.evidence);
  if (evidence) task.evidence = [...new Set([...(task.evidence ?? []), ...evidence])];
  if (Array.isArray(options.validations)) task.validations = clone(options.validations);
  if (options.reviewResult !== undefined) task.reviewResult = options.reviewResult || null;
  if (options.regressions !== undefined) task.regressions = Number(options.regressions);

  if (!Array.isArray(task.attemptHistory)) task.attemptHistory = [];
  if (status === "RUNNING") {
    const recoveringSameAttempt = ["STALLED", "UNKNOWN"].includes(previousStatus) &&
      Number(task.attempt ?? 0) > 0 && options.newAttempt !== true;
    const newAttempt = !sameStatus && !recoveringSameAttempt;
    if (newAttempt) task.attempt = Number(task.attempt ?? 0) + 1;
    task.startedAt = sameStatus || recoveringSameAttempt ? task.startedAt ?? now : now;
    task.completedAt = null;
    task.lastActivityAt = now;
    task.commitBefore = options.commitBefore ?? task.commitBefore ?? git.head ?? null;
    task.commitAfter = null;
    task.stall = null;
    task.reconciliation = null;
    const attemptIndex = task.attemptHistory.findIndex((entry) => Number(entry.attempt) === Number(task.attempt));
    const attemptRecord = {
      ...(attemptIndex >= 0 ? task.attemptHistory[attemptIndex] : {}),
      attempt: Number(task.attempt),
      executor: task.executor ?? null,
      model: task.model ?? null,
      status: "RUNNING",
      startedAt: attemptIndex >= 0
        ? task.attemptHistory[attemptIndex].startedAt ?? task.startedAt
        : task.startedAt,
      completedAt: null,
      durationMs: null,
      reasonCode: null,
      reviewResult: null,
      regressions: 0,
      sessionId: task.sessionId ?? null,
      conversationId: task.conversationId ?? null,
      commitBefore: task.commitBefore ?? null,
      commitAfter: null,
    };
    if (attemptIndex >= 0) task.attemptHistory[attemptIndex] = attemptRecord;
    else task.attemptHistory.push(attemptRecord);
  } else if (status === "DONE") {
    task.completedAt = now;
    task.lastActivityAt = now;
    task.commitAfter = options.commitAfter ?? git.head ?? task.commitAfter ?? null;
  } else if (status === "STALLED") {
    task.stall = {
      ...(task.stall ?? {}),
      detectedAt: now,
      reason: options.reason ?? "No observable progress",
    };
  } else if (status === "UNKNOWN") {
    task.unknownAt = now;
  } else if (["FAILED", "BLOCKED", "CANCELLED"].includes(status)) {
    task.completedAt = status === "BLOCKED" ? null : now;
  }

  if (["DONE", "FAILED", "BLOCKED", "CANCELLED"].includes(status) && Number(task.attempt ?? 0) > 0) {
    const attemptIndex = task.attemptHistory.findIndex((entry) => Number(entry.attempt) === Number(task.attempt));
    const previousAttempt = attemptIndex >= 0 ? task.attemptHistory[attemptIndex] : {
      attempt: Number(task.attempt),
      executor: task.executor ?? null,
      model: task.model ?? null,
      startedAt: task.startedAt ?? now,
    };
    const completedAt = task.completedAt ?? now;
    const startedMs = Date.parse(previousAttempt.startedAt ?? "");
    const completedMs = Date.parse(completedAt);
    const record = {
      ...previousAttempt,
      executor: task.executor ?? previousAttempt.executor ?? null,
      model: task.model ?? previousAttempt.model ?? null,
      status,
      completedAt,
      durationMs: Number.isFinite(startedMs) && Number.isFinite(completedMs)
        ? Math.max(0, completedMs - startedMs)
        : null,
      reasonCode: task.reasonCode ?? null,
      reviewResult: task.reviewResult ?? null,
      regressions: Number(task.regressions ?? 0),
      commitAfter: task.commitAfter ?? null,
    };
    if (attemptIndex >= 0) task.attemptHistory[attemptIndex] = record;
    else task.attemptHistory.push(record);
  }

  return task;
}

function assertTaskDoneEvidence(task, projectRoot, git) {
  const expected = pathEvidence(projectRoot, task.expectedFiles ?? []);
  const missingExpected = expected.filter((entry) => !entry.exists || !entry.insideProject);
  if (missingExpected.length > 0) {
    throw new OrchestrationStateError(
      "TASK_EXPECTED_FILES_MISSING",
      `Task ${task.id} cannot be DONE while expected files are missing`,
      { files: missingExpected },
    );
  }
  const produced = pathEvidence(projectRoot, task.producedFiles ?? []);
  const fileEvidence = [...expected, ...produced].some(
    (entry) => entry.exists && entry.insideProject,
  );
  const validationEvidence = allValidationsPass(task.validations) === true;
  const recordedEvidence = Array.isArray(task.evidence) && task.evidence.length > 0;
  const commitEvidence = Boolean(
    task.commitBefore &&
    (task.commitAfter ?? git.head) &&
    task.commitBefore !== (task.commitAfter ?? git.head),
  );
  if (!fileEvidence && !validationEvidence && !recordedEvidence && !commitEvidence) {
    throw new OrchestrationStateError(
      "TASK_DONE_REQUIRES_EVIDENCE",
      `Task ${task.id} cannot be DONE without produced files, passing validation, commit delta, or recorded executor evidence`,
    );
  }
}

export function updateTaskStatus(artifactDir, taskId, status, options = {}) {
  const normalizedStatus = String(status ?? "").toUpperCase();
  if (!TASK_STATUS_SET.has(normalizedStatus)) {
    throw new OrchestrationStateError(
      "INVALID_TASK_STATUS",
      `Invalid task status: ${status}`,
    );
  }

  return withLock(artifactDir, () => {
    const state = loadRun(artifactDir, { repairSnapshot: true }).state;
    assertRunMutable(state, "update a task");
    const normalizedTaskId = ensureTask(state, taskId);
    const now = iso(options.now);
    const projectRoot = resolve(options.projectRoot ?? join(resolve(artifactDir), "..", ".."));
    const git = inspectGit(projectRoot);
    const task = mergeTaskFields(
      state.tasks[normalizedTaskId],
      normalizedStatus,
      options,
      now,
      git,
    );
    if (normalizedStatus === "DONE") assertTaskDoneEvidence(task, projectRoot, git);
    const tasks = { ...state.tasks, [normalizedTaskId]: task };
    const draft = { ...state, tasks };
    const runStatus = deriveRunStatus(tasks, state.status);
    const currentWave = computeCurrentWave(draft);
    const committed = commitEvent(
      artifactDir,
      state,
      "TASK_UPDATED",
      { taskId: normalizedTaskId, task, runStatus, currentWave },
      options,
    );
    return {
      state: committed.state,
      event: committed.event,
      task: committed.state.tasks[normalizedTaskId],
      summary: runSummary(committed.state),
    };
  }, options);
}

export function heartbeatTask(artifactDir, taskId, options = {}) {
  return withLock(artifactDir, () => {
    const state = loadRun(artifactDir, { repairSnapshot: true }).state;
    assertRunMutable(state, "record a heartbeat");
    const normalizedTaskId = ensureTask(state, taskId);
    const previous = state.tasks[normalizedTaskId];
    if (!["RUNNING", "STALLED"].includes(previous.status)) {
      throw new OrchestrationStateError(
        "HEARTBEAT_NOT_ALLOWED",
        `Task ${normalizedTaskId} is ${previous.status}; heartbeat requires RUNNING or STALLED`,
      );
    }

    const now = iso(options.now);
    const apiCalls = options.apiCalls === undefined ? previous.apiCalls : Number(options.apiCalls);
    const toolCalls = options.toolCalls === undefined ? previous.toolCalls : Number(options.toolCalls);
    const currentTool = options.currentTool === undefined
      ? previous.currentTool
      : options.currentTool || null;
    const inTool = options.inTool === undefined ? previous.inTool : Boolean(options.inTool);
    const progressToken = options.progressToken === undefined
      ? previous.progressToken ?? null
      : String(options.progressToken);
    const observedProgress =
      (options.apiCalls !== undefined && apiCalls !== previous.apiCalls) ||
      (options.toolCalls !== undefined && toolCalls !== previous.toolCalls) ||
      (options.currentTool !== undefined && currentTool !== previous.currentTool) ||
      (options.inTool !== undefined && inTool !== previous.inTool) ||
      (options.progressToken !== undefined && progressToken !== (previous.progressToken ?? null));

    if (!observedProgress) {
      return {
        changed: false,
        state,
        task: previous,
        summary: runSummary(state),
      };
    }

    const task = {
      ...clone(previous),
      status: "RUNNING",
      lastActivityAt: now,
      updatedAt: now,
      apiCalls,
      toolCalls,
      currentTool,
      inTool,
      progressToken,
      stall: previous.status === "STALLED"
        ? { ...(previous.stall ?? {}), recoveredAt: now }
        : previous.stall ?? null,
    };
    const tasks = { ...state.tasks, [normalizedTaskId]: task };
    const draft = { ...state, tasks };
    const runStatus = deriveRunStatus(tasks, state.status);
    const currentWave = computeCurrentWave(draft);
    const committed = commitEvent(
      artifactDir,
      state,
      "TASK_HEARTBEAT",
      { taskId: normalizedTaskId, task, runStatus, currentWave },
      options,
    );
    return {
      changed: true,
      state: committed.state,
      event: committed.event,
      task: committed.state.tasks[normalizedTaskId],
      summary: runSummary(committed.state),
    };
  }, options);
}

export function sweepStalledTasks(artifactDir, options = {}) {
  return withLock(artifactDir, () => {
    const state = loadRun(artifactDir, { repairSnapshot: true }).state;
    assertRunMutable(state, "sweep stalled tasks");
    const nowDate = asDate(options.now);
    const now = iso(nowDate);
    const idleSeconds = Number(
      options.staleIdleSeconds ?? state.lifecycle?.staleIdleSeconds ?? 450,
    );
    const inToolSeconds = Number(
      options.staleInToolSeconds ?? state.lifecycle?.staleInToolSeconds ?? 1200,
    );
    const graceSeconds = Number(
      options.stallGraceSeconds ?? state.lifecycle?.stallGraceSeconds ?? 120,
    );
    const tasks = clone(state.tasks);
    const stalled = [];
    const graceExpired = [];

    for (const task of Object.values(tasks)) {
      if (task.status === "RUNNING") {
        const last = task.lastActivityAt ?? task.startedAt;
        if (!last) continue;
        const quietSeconds = Math.max(0, (nowDate.getTime() - new Date(last).getTime()) / 1000);
        const thresholdSeconds = task.inTool ? inToolSeconds : idleSeconds;
        if (quietSeconds >= thresholdSeconds) {
          task.status = "STALLED";
          task.updatedAt = now;
          task.stall = {
            detectedAt: now,
            quietSeconds: Math.round(quietSeconds * 100) / 100,
            thresholdSeconds,
            phase: task.inTool ? "in_tool" : "idle",
            graceSeconds,
            graceUntil: new Date(nowDate.getTime() + graceSeconds * 1000).toISOString(),
            recommendation: "INTERRUPT_THEN_RECONCILE",
          };
          stalled.push(task.id);
        }
      } else if (task.status === "STALLED" && task.stall?.graceUntil) {
        if (nowDate.getTime() >= new Date(task.stall.graceUntil).getTime() && !task.stall.graceExpiredAt) {
          task.updatedAt = now;
          task.stall.graceExpiredAt = now;
          task.stall.recommendation = "CANCEL_OR_RETRY_AFTER_RECONCILIATION";
          graceExpired.push(task.id);
        }
      }
    }

    const changed = stalled.length > 0 || graceExpired.length > 0;
    if (!changed) {
      return {
        changed: false,
        state,
        stalled,
        graceExpired,
        summary: runSummary(state),
      };
    }

    const draft = { ...state, tasks };
    const runStatus = deriveRunStatus(tasks, state.status);
    const currentWave = computeCurrentWave(draft);
    const lifecycle = {
      staleIdleSeconds: idleSeconds,
      staleInToolSeconds: inToolSeconds,
      stallGraceSeconds: graceSeconds,
      lastSweepAt: now,
    };
    const committed = commitEvent(
      artifactDir,
      state,
      "STALL_SWEEP_COMPLETED",
      { tasks, runStatus, currentWave, lifecycle, stalled, graceExpired },
      options,
    );
    return {
      changed: true,
      state: committed.state,
      event: committed.event,
      stalled,
      graceExpired,
      summary: runSummary(committed.state),
    };
  }, options);
}

function resolveProjectRoot(artifactDir, options) {
  return resolve(options.projectRoot ?? join(resolve(artifactDir), "..", ".."));
}

function pathEvidence(projectRoot, paths) {
  const checked = [];
  for (const path of normalizeList(paths) ?? []) {
    const absolute = isAbsolute(path) ? resolve(path) : resolve(projectRoot, path);
    const rel = relative(projectRoot, absolute);
    const inside = rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
    checked.push({
      path: toPosix(path),
      exists: inside && existsSync(absolute),
      insideProject: inside,
    });
  }
  return checked;
}

function normalizeExternalStatus(probe) {
  const raw = String(
    probe?.executorStatus ?? probe?.sessionStatus ?? probe?.conversationStatus ?? probe?.status ?? "",
  ).toUpperCase();
  const map = {
    COMPLETED: "DONE",
    COMPLETE: "DONE",
    SUCCESS: "DONE",
    SUCCEEDED: "DONE",
    IN_PROGRESS: "RUNNING",
    DISPATCHED: "RUNNING",
    ERROR: "FAILED",
    TIMED_OUT: "FAILED",
    TIMEOUT: "FAILED",
    QUOTA_EXHAUSTED: "BLOCKED",
    QUOTA_EXAUSTED: "BLOCKED",
    AUTH_REQUIRED: "BLOCKED",
    AGY_MISSING: "BLOCKED",
    NEEDS_SYNC: "BLOCKED",
  };
  const normalized = map[raw] ?? raw;
  const status = TASK_STATUS_SET.has(normalized) ? normalized : null;
  const operationalReasonCodes = new Set([
    "QUOTA_EXHAUSTED",
    "QUOTA_EXAUSTED",
    "AUTH_REQUIRED",
    "AGY_MISSING",
    "TIMEOUT",
    "TIMED_OUT",
    "NEEDS_SYNC",
  ]);
  return {
    raw: raw || null,
    status,
    reasonCode: probe?.reasonCode ?? (operationalReasonCodes.has(raw) ? raw : null),
  };
}

function readProbeFile(path) {
  if (!path) return { tasks: {} };
  const parsed = safeJsonParse(readFileSync(resolve(path), "utf8"), resolve(path));
  if (!parsed || typeof parsed.tasks !== "object" || Array.isArray(parsed.tasks)) {
    throw new OrchestrationStateError(
      "INVALID_PROBE_FILE",
      "Probe file must contain an object shaped as { tasks: { <taskId>: {...} } }",
    );
  }
  return parsed;
}

function allValidationsPass(validations) {
  if (!Array.isArray(validations) || validations.length === 0) return null;
  return validations.every((item) => {
    const value = typeof item === "object" ? item.status ?? item.passed : item;
    if (value === true) return true;
    return ["PASS", "PASSED", "SUCCESS", "OK"].includes(String(value).toUpperCase());
  });
}

function reconcileTask(task, probe, projectRoot, git, now) {
  const next = clone(task);
  const previousStatus = next.status;
  if (TERMINAL_TASK_STATUSES.has(next.status)) return next;
  const external = normalizeExternalStatus(probe);
  const externalStatus = external.status;
  const expected = pathEvidence(projectRoot, [
    ...(task.expectedFiles ?? []),
    ...(probe?.expectedFiles ?? []),
  ]);
  const produced = pathEvidence(projectRoot, [
    ...(task.producedFiles ?? []),
    ...(probe?.producedFiles ?? probe?.files ?? []),
  ]);
  const files = [...expected, ...produced].filter(
    (entry, index, array) => array.findIndex((item) => item.path === entry.path) === index,
  );
  const missingExpected = expected.filter((entry) => !entry.exists).map((entry) => entry.path);
  const validations = Array.isArray(probe?.validations)
    ? clone(probe.validations)
    : clone(task.validations ?? []);
  const validationsPass = allValidationsPass(validations);
  const changedFiles = changedFilesSince(projectRoot, task.commitBefore, git);
  const presentFiles = files.filter((entry) => entry.exists && entry.insideProject);
  const commitCorroborated = Boolean(
    probe?.commitAfter && git.available && probe.commitAfter === git.head,
  );
  const localCorroboration = validationsPass === true
    ? "validation"
    : presentFiles.length > 0
      ? "file"
      : commitCorroborated
        ? "commit"
        : null;
  let recommendation = "VERIFY";
  let reason = "No authoritative executor result was observed";

  if (externalStatus === "RUNNING") {
    next.status = "RUNNING";
    next.lastActivityAt = probe.lastActivityAt ?? next.lastActivityAt ?? now;
    recommendation = "MONITOR";
    reason = "Executor reports that the task is still running";
  } else if (validationsPass === false && externalStatus == null) {
    next.status = "FAILED";
    next.completedAt = now;
    next.reasonCode = probe?.reasonCode ?? "VALIDATION_FAILED";
    recommendation = "FIX_OR_REEXECUTE";
    reason = "At least one task-scoped reconciliation validation failed";
  } else if (externalStatus === "DONE") {
    if (validationsPass === false) {
      next.status = "FAILED";
      next.reasonCode = probe?.reasonCode ?? "VALIDATION_FAILED";
      recommendation = "FIX_OR_REEXECUTE";
      reason = "Executor completed, but at least one validation failed";
    } else if (missingExpected.length > 0) {
      next.status = "UNKNOWN";
      recommendation = "VERIFY_OR_REEXECUTE";
      reason = "Executor reports completion, but expected files are missing";
    } else if (localCorroboration == null) {
      next.status = "UNKNOWN";
      recommendation = "COLLECT_LOCAL_EVIDENCE";
      reason = "Executor reports completion, but no local file, passing validation, or commit evidence corroborates it";
    } else {
      next.status = "DONE";
      next.completedAt = probe.completedAt ?? now;
      next.commitAfter = probe.commitAfter ?? git.head ?? next.commitAfter ?? null;
      next.reasonCode = external.reasonCode;
      recommendation = "CONTINUE";
      reason = "Authoritative executor completion is consistent with local evidence";
    }
  } else if (externalStatus === "FAILED") {
    next.status = "FAILED";
    next.completedAt = probe.completedAt ?? now;
    next.reasonCode = external.reasonCode ?? probe?.reasonCode ?? "EXECUTOR_FAILED";
    recommendation = changedFiles.length > 0 ? "INSPECT_PARTIAL_THEN_RETRY" : "REEXECUTE";
    reason = probe.error ?? probe.reason ?? "Executor reports failure";
  } else if (externalStatus === "BLOCKED") {
    next.status = "BLOCKED";
    next.reasonCode = external.reasonCode ?? probe?.reasonCode ?? "EXECUTOR_BLOCKED";
    recommendation = "RESOLVE_BLOCKER";
    reason = probe.error ?? probe.reason ?? "Executor reports an operational blocker";
  } else if (externalStatus === "CANCELLED") {
    next.status = "CANCELLED";
    next.reasonCode = external.reasonCode ?? probe?.reasonCode ?? "EXECUTOR_CANCELLED";
    recommendation = "DO_NOT_REEXECUTE_WITHOUT_USER_INTENT";
    reason = probe.reason ?? "Executor reports cancellation";
  } else if (externalStatus === "STALLED") {
    next.status = "STALLED";
    next.reasonCode = external.reasonCode ?? probe?.reasonCode ?? "EXECUTOR_STALLED";
    recommendation = "INTERRUPT_THEN_RECONCILE";
    reason = probe.reason ?? "Executor reports no progress";
  } else if (next.status === "STALLED") {
    recommendation = next.stall?.graceExpiredAt
      ? "CANCEL_OR_RETRY_AFTER_RECONCILIATION"
      : "INTERRUPT_THEN_RECONCILE";
    reason = "No new progress was observed for a previously stalled task";
  } else if (next.status === "UNKNOWN" || next.status === "RUNNING") {
    next.status = "UNKNOWN";
    if (changedFiles.length > 0 || files.some((entry) => entry.exists)) {
      recommendation = "VERIFY_BEFORE_REEXECUTE";
      reason = "Local changes exist, but there is no authoritative executor outcome";
    } else {
      recommendation = "REEXECUTE_AFTER_CONFIRMING_SESSION_IS_GONE";
      reason = "No executor outcome or local task evidence was found";
    }
  }

  next.validations = validations;
  next.updatedAt = now;
  next.reconciliation = {
    reconciledAt: now,
    externalStatus,
    externalRawStatus: external.raw,
    reasonCode: external.reasonCode ?? next.reasonCode ?? null,
    files,
    missingExpected,
    validationsPass,
    localCorroboration,
    changedFiles,
    recommendation,
    reason,
  };
  if (!Array.isArray(next.attemptHistory)) next.attemptHistory = [];
  if (externalStatus === "RUNNING" && Number(next.attempt ?? 0) === 0) {
    next.attempt = 1;
    next.startedAt = probe?.startedAt ?? now;
  }
  if (Number(next.attempt ?? 0) > 0) {
    const attemptIndex = next.attemptHistory.findIndex((entry) => Number(entry.attempt) === Number(next.attempt));
    const previousAttempt = attemptIndex >= 0 ? next.attemptHistory[attemptIndex] : {
      attempt: Number(next.attempt),
      executor: next.executor ?? null,
      model: next.model ?? null,
      startedAt: next.startedAt ?? probe?.startedAt ?? now,
      sessionId: next.sessionId ?? null,
      conversationId: next.conversationId ?? null,
      commitBefore: next.commitBefore ?? null,
    };
    const terminal = ["DONE", "FAILED", "BLOCKED", "CANCELLED"].includes(next.status);
    const completedAt = terminal ? next.completedAt ?? now : null;
    const startedMs = Date.parse(previousAttempt.startedAt ?? "");
    const completedMs = Date.parse(completedAt ?? "");
    const record = {
      ...previousAttempt,
      executor: next.executor ?? previousAttempt.executor ?? null,
      model: next.model ?? previousAttempt.model ?? null,
      status: next.status,
      completedAt,
      durationMs: terminal && Number.isFinite(startedMs) && Number.isFinite(completedMs)
        ? Math.max(0, completedMs - startedMs)
        : null,
      reasonCode: next.reasonCode ?? null,
      reviewResult: next.reviewResult ?? null,
      regressions: Number(next.regressions ?? 0),
      commitAfter: next.commitAfter ?? null,
    };
    if (attemptIndex >= 0) next.attemptHistory[attemptIndex] = record;
    else next.attemptHistory.push(record);
  }
  return next;
}

function reconcileLocked(artifactDir, state, options = {}) {
  const projectRoot = resolveProjectRoot(artifactDir, options);
  const probeSet = readProbeFile(options.probeFile);
  const now = iso(options.now);
  const git = inspectGit(projectRoot);
  const tasks = {};
  const recommendations = [];
  const pendingExternalProbes = [];

  for (const [taskId, task] of Object.entries(state.tasks)) {
    const probe = probeSet.tasks?.[taskId] ?? probeSet.tasks?.[taskId.toLowerCase()] ?? null;
    if (["UNKNOWN", "RUNNING", "STALLED", "FAILED", "BLOCKED"].includes(task.status) || probe) {
      tasks[taskId] = reconcileTask(task, probe, projectRoot, git, now);
    } else {
      tasks[taskId] = clone(task);
    }

    const reconciled = tasks[taskId].reconciliation;
    if (reconciled && reconciled.recommendation !== "CONTINUE") {
      recommendations.push({
        taskId,
        action: reconciled.recommendation,
        reason: reconciled.reason,
      });
    }
    if (tasks[taskId].status === "UNKNOWN") {
      pendingExternalProbes.push({
        taskId,
        executor: tasks[taskId].executor,
        sessionId: tasks[taskId].sessionId,
        conversationId: tasks[taskId].conversationId,
        required: true,
      });
    }
  }

  const draft = { ...state, tasks };
  const currentWave = computeCurrentWave(draft);
  const runStatus = deriveRunStatus(tasks, state.status);
  const resumeFromPhase = nextSafeResumePhase(state.lastSafePhase);
  const resume = {
    ...(state.resume ?? {}),
    lastReconciledAt: now,
    resumeFromPhase,
    pendingExternalProbes,
    recommendations,
  };
  const repository = {
    ...(state.repository ?? {}),
    ...git,
    lastObservedHead: git.head ?? state.repository?.lastObservedHead ?? null,
  };

  return {
    tasks,
    runStatus,
    currentWave,
    repository,
    resume,
    report: {
      runId: state.runId,
      reconciledAt: now,
      resumeFromPhase,
      resumeFromPhaseName: phaseName(resumeFromPhase),
      currentWave,
      pendingExternalProbes,
      recommendations,
      git,
    },
  };
}

export function reconcileRunAtDirectory(artifactDir, options = {}) {
  return withLock(artifactDir, () => {
    const state = loadRun(artifactDir, { repairSnapshot: true, verifyReplay: true }).state;
    assertRunMutable(state, "reconcile executors");
    const result = reconcileLocked(artifactDir, state, options);
    const committed = commitEvent(
      artifactDir,
      state,
      "RUN_RECONCILED",
      {
        tasks: result.tasks,
        runStatus: result.runStatus,
        currentWave: result.currentWave,
        repository: result.repository,
        resume: result.resume,
      },
      options,
    );
    return {
      state: committed.state,
      event: committed.event,
      report: result.report,
      summary: runSummary(committed.state),
    };
  }, options);
}

export function resumeRunAtDirectory(artifactDir, options = {}) {
  return withLock(artifactDir, () => {
    let state = loadRun(artifactDir, { repairSnapshot: true, verifyReplay: true }).state;
    if (["DONE", "CANCELLED"].includes(state.status)) {
      throw new OrchestrationStateError(
        "RUN_TERMINAL",
        `Run ${state.runId} is already ${state.status} and cannot be resumed`,
      );
    }
    const now = iso(options.now);
    const tasks = clone(state.tasks);
    const unknownTasks = [];

    for (const task of Object.values(tasks)) {
      if (task.status === "RUNNING") {
        task.status = "UNKNOWN";
        task.unknownAt = now;
        task.updatedAt = now;
        task.reasonCode = "OWNER_SESSION_INTERRUPTED";
        task.reason = "Previous orchestrator session ended without a durable terminal result";
        unknownTasks.push(task.id);
      }
    }

    const draft = { ...state, tasks };
    const currentWave = computeCurrentWave(draft);
    const runStatus = deriveRunStatus(tasks, state.status);
    const resume = {
      ...(state.resume ?? {}),
      count: Number(state.resume?.count ?? 0) + 1,
      lastResumedAt: now,
      resumeFromPhase: nextSafeResumePhase(state.lastSafePhase),
      pendingExternalProbes: [],
      recommendations: [],
    };
    const resumed = commitEvent(
      artifactDir,
      state,
      "RUN_RESUMED",
      { tasks, runStatus, currentWave, resume, unknownTasks },
      options,
    );
    state = resumed.state;

    const reconciled = reconcileLocked(artifactDir, state, options);
    const committed = commitEvent(
      artifactDir,
      state,
      "RUN_RECONCILED",
      {
        tasks: reconciled.tasks,
        runStatus: reconciled.runStatus,
        currentWave: reconciled.currentWave,
        repository: reconciled.repository,
        resume: reconciled.resume,
      },
      options,
    );
    return {
      state: committed.state,
      events: [resumed.event, committed.event],
      unknownTasks,
      report: reconciled.report,
      summary: runSummary(committed.state),
    };
  }, options);
}

export function resolveTaskScope(artifactDir, taskId, decision, options = {}) {
  const normalizedDecision = String(decision ?? "").toUpperCase();
  if (!new Set(["REMOVE", "REINSTATE"]).has(normalizedDecision)) {
    throw new OrchestrationStateError(
      "INVALID_SCOPE_DECISION",
      `Scope decision must be REMOVE or REINSTATE, received ${decision}`,
    );
  }
  if (!options.reason) {
    throw new OrchestrationStateError(
      "SCOPE_DECISION_REQUIRES_REASON",
      "A durable scope decision requires a reason",
    );
  }
  return withLock(artifactDir, () => {
    const state = loadRun(artifactDir, { repairSnapshot: true }).state;
    assertRunMutable(state, "resolve task scope");
    const normalizedTaskId = ensureTask(state, taskId);
    const previous = state.tasks[normalizedTaskId];
    const now = iso(options.now);
    if (normalizedDecision === "REMOVE") {
      if (previous.sourcePresent !== false) {
        throw new OrchestrationStateError(
          "TASK_STILL_PRESENT_IN_SOURCE",
          `Task ${normalizedTaskId} is still present in tasks-classification.md`,
        );
      }
      if (["RUNNING", "STALLED", "UNKNOWN"].includes(previous.status)) {
        throw new OrchestrationStateError(
          "TASK_SCOPE_ACTIVE",
          `Task ${normalizedTaskId} must be interrupted and reconciled before removal`,
        );
      }
    } else if (previous.sourcePresent === false) {
      throw new OrchestrationStateError(
        "TASK_NOT_REINSTATED_IN_SOURCE",
        `Restore task ${normalizedTaskId} in tasks-classification.md and sync before REINSTATE`,
      );
    }

    const task = {
      ...clone(previous),
      status: normalizedDecision === "REMOVE" && previous.status !== "DONE"
        ? "CANCELLED"
        : previous.status,
      completedAt: normalizedDecision === "REMOVE" && previous.status !== "DONE"
        ? now
        : previous.completedAt,
      scopeResolution: {
        status: normalizedDecision === "REMOVE" ? "REMOVED" : "REINSTATED",
        reason: options.reason,
        decidedBy: options.actor ?? "orchestrator",
        decidedAt: now,
      },
      reasonCode: normalizedDecision === "REMOVE"
        ? "SCOPE_REMOVED"
        : previous.reasonCode,
      updatedAt: now,
    };
    const tasks = { ...state.tasks, [normalizedTaskId]: task };
    const currentWave = computeCurrentWave({ ...state, tasks });
    const runStatus = deriveRunStatus(tasks, state.status);
    const sync = {
      ...(state.sync ?? {}),
      scopeResolutions: {
        ...(state.sync?.scopeResolutions ?? {}),
        [normalizedTaskId]: clone(task.scopeResolution),
      },
    };
    const committed = commitEvent(
      artifactDir,
      state,
      "TASK_SCOPE_RESOLVED",
      { taskId: normalizedTaskId, task, runStatus, currentWave, sync },
      options,
    );
    return {
      state: committed.state,
      event: committed.event,
      task: committed.state.tasks[normalizedTaskId],
      summary: runSummary(committed.state),
    };
  }, options);
}

export function updateTaskLease(artifactDir, taskId, action, options = {}) {
  const normalizedAction = String(action ?? "").toUpperCase();
  if (!new Set(["ACQUIRE", "RENEW", "RELEASE"]).has(normalizedAction)) {
    throw new OrchestrationStateError(
      "INVALID_LEASE_ACTION",
      `Lease action must be ACQUIRE, RENEW, or RELEASE; received ${action}`,
    );
  }
  const ownerId = String(options.ownerId ?? "").trim();
  if (!ownerId) {
    throw new OrchestrationStateError("LEASE_OWNER_REQUIRED", "A lease ownerId is required");
  }
  return withLock(artifactDir, () => {
    const state = loadRun(artifactDir, { repairSnapshot: true }).state;
    assertRunMutable(state, `${normalizedAction.toLowerCase()} a task lease`);
    const normalizedTaskId = ensureTask(state, taskId);
    const nowDate = asDate(options.now);
    const now = iso(nowDate);
    const previous = clone(state.tasks[normalizedTaskId]);
    const lease = previous.lease ?? null;
    const leaseActive = lease?.status === "ACTIVE" &&
      new Date(lease.expiresAt).getTime() > nowDate.getTime();

    if (normalizedAction === "ACQUIRE" && leaseActive && lease.ownerId !== ownerId) {
      throw new OrchestrationStateError(
        "TASK_LEASE_HELD",
        `Task ${normalizedTaskId} is leased by ${lease.ownerId}`,
        { lease },
      );
    }
    if (["RENEW", "RELEASE"].includes(normalizedAction) && leaseActive && lease.ownerId !== ownerId) {
      throw new OrchestrationStateError(
        "TASK_LEASE_OWNERSHIP_MISMATCH",
        `Task ${normalizedTaskId} lease belongs to ${lease.ownerId}`,
      );
    }
    if (normalizedAction === "RENEW" && !leaseActive) {
      throw new OrchestrationStateError(
        "TASK_LEASE_EXPIRED",
        `Task ${normalizedTaskId} has no active lease to renew`,
      );
    }

    const ttlSeconds = Math.max(30, Number(options.ttlSeconds ?? 900));
    previous.lease = normalizedAction === "RELEASE"
      ? {
          ...(lease ?? {}),
          ownerId,
          status: "RELEASED",
          releasedAt: now,
          updatedAt: now,
        }
      : {
          ownerId,
          status: "ACTIVE",
          acquiredAt: normalizedAction === "ACQUIRE"
            ? now
            : lease.acquiredAt,
          renewedAt: normalizedAction === "RENEW" ? now : null,
          expiresAt: new Date(nowDate.getTime() + ttlSeconds * 1000).toISOString(),
          ttlSeconds,
          updatedAt: now,
        };
    previous.updatedAt = now;
    const tasks = { ...state.tasks, [normalizedTaskId]: previous };
    const currentWave = computeCurrentWave({ ...state, tasks });
    const runStatus = deriveRunStatus(tasks, state.status);
    const committed = commitEvent(
      artifactDir,
      state,
      "TASK_LEASE_UPDATED",
      { taskId: normalizedTaskId, task: previous, runStatus, currentWave },
      options,
    );
    return {
      state: committed.state,
      event: committed.event,
      lease: committed.state.tasks[normalizedTaskId].lease,
      summary: runSummary(committed.state),
    };
  }, options);
}

const WORKSPACE_STATUSES = new Set([
  "PLANNED",
  "CREATED",
  "RUNNING",
  "READY",
  "INTEGRATING",
  "MERGED",
  "CONFLICT",
  "BLOCKED",
  "CLEANED",
  "UNKNOWN",
]);

export function updateTaskWorkspace(artifactDir, taskId, workspace, options = {}) {
  const status = String(workspace?.status ?? "UNKNOWN").toUpperCase();
  if (!WORKSPACE_STATUSES.has(status)) {
    throw new OrchestrationStateError(
      "INVALID_WORKSPACE_STATUS",
      `Invalid workspace status: ${workspace?.status}`,
    );
  }
  return withLock(artifactDir, () => {
    const state = loadRun(artifactDir, { repairSnapshot: true }).state;
    assertRunMutable(state, "update a task workspace");
    const normalizedTaskId = ensureTask(state, taskId);
    const now = iso(options.now);
    const task = {
      ...clone(state.tasks[normalizedTaskId]),
      workspace: {
        ...(state.tasks[normalizedTaskId].workspace ?? {}),
        ...clone(workspace),
        status,
        updatedAt: now,
      },
      updatedAt: now,
    };
    const tasks = { ...state.tasks, [normalizedTaskId]: task };
    const currentWave = computeCurrentWave({ ...state, tasks });
    const runStatus = deriveRunStatus(tasks, state.status);
    const committed = commitEvent(
      artifactDir,
      state,
      "TASK_WORKSPACE_UPDATED",
      { taskId: normalizedTaskId, task, runStatus, currentWave },
      options,
    );
    return {
      state: committed.state,
      event: committed.event,
      workspace: committed.state.tasks[normalizedTaskId].workspace,
      summary: runSummary(committed.state),
    };
  }, options);
}

export function requestRunCancellation(artifactDir, options = {}) {
  if (!options.reason) {
    throw new OrchestrationStateError(
      "CANCELLATION_REQUIRES_REASON",
      "Run cancellation requires a reason",
    );
  }
  return withLock(artifactDir, () => {
    const state = loadRun(artifactDir, { repairSnapshot: true, verifyReplay: true }).state;
    assertRunMutable(state, "request cancellation");
    const now = iso(options.now);
    const tasks = clone(state.tasks);
    const pendingExecutorStops = [];
    for (const task of Object.values(tasks)) {
      if (["RUNNING", "STALLED", "UNKNOWN"].includes(task.status)) {
        task.status = "UNKNOWN";
        task.unknownAt = now;
        task.reasonCode = "CANCEL_REQUESTED";
        task.reason = options.reason;
        task.updatedAt = now;
        pendingExecutorStops.push({
          taskId: task.id,
          executor: task.executor,
          sessionId: task.sessionId,
          conversationId: task.conversationId,
          action: "INTERRUPT_THEN_RECONCILE",
        });
      } else if (["PENDING", "FAILED", "BLOCKED"].includes(task.status)) {
        task.status = "CANCELLED";
        task.completedAt = now;
        task.reasonCode = "CANCEL_REQUESTED";
        task.reason = options.reason;
        task.updatedAt = now;
      }
    }
    const currentWave = computeCurrentWave({ ...state, tasks });
    const runStatus = pendingExecutorStops.length > 0 ? "UNKNOWN" : "BLOCKED";
    assertRunTransition(state, runStatus);
    const cancellation = {
      requestedAt: state.cancellation?.requestedAt ?? now,
      requestedBy: options.actor ?? "orchestrator",
      reason: options.reason,
      pendingExecutorStops,
      finalizedAt: null,
    };
    const resume = {
      ...(state.resume ?? {}),
      pendingExternalProbes: pendingExecutorStops.map((entry) => ({
        taskId: entry.taskId,
        executor: entry.executor,
        sessionId: entry.sessionId,
        conversationId: entry.conversationId,
        required: true,
        purpose: "cancellation",
      })),
      recommendations: pendingExecutorStops.map((entry) => ({
        taskId: entry.taskId,
        action: entry.action,
        reason: "Cancellation was requested; verify the executor stopped before finalizing",
      })),
    };
    const committed = commitEvent(
      artifactDir,
      state,
      "RUN_CANCELLATION_REQUESTED",
      { tasks, runStatus, currentWave, cancellation, resume },
      options,
    );
    return {
      state: committed.state,
      event: committed.event,
      pendingExecutorStops,
      summary: runSummary(committed.state),
    };
  }, options);
}

export function auditRunCompletion(artifactDir) {
  const state = loadRun(artifactDir, { verifyReplay: true }).state;
  return completionAudit(artifactDir, state);
}

function completionAudit(artifactDir, state) {
  const tasks = Object.values(state.tasks ?? {});
  const unresolvedScope = tasks.filter(
    (task) => task.sourcePresent === false && task.scopeResolution?.status !== "REMOVED",
  );
  const incompleteTasks = tasks.filter((task) => {
    if (task.sourcePresent === false && task.scopeResolution?.status === "REMOVED") {
      return !["DONE", "CANCELLED"].includes(task.status);
    }
    return task.status !== "DONE";
  });
  const tasksWithoutEvidencePlan = tasks.filter(
    (task) =>
      task.sourcePresent !== false &&
      (task.expectedFiles ?? []).length === 0 &&
      (task.validationPlan ?? []).length === 0,
  );
  const completionGates = synchronizeCompletionGates(
    state.completionGates,
    state.tasks,
    state.updatedAt,
  );
  const incompleteGates = Object.values(completionGates).filter((gate) =>
    gate.required ? gate.status !== "DONE" : !["DONE", "N/A"].includes(gate.status),
  );
  const gatesWithoutEvidence = Object.values(completionGates).filter(
    (gate) => gate.status === "DONE" && (gate.evidence ?? []).length === 0,
  );
  const requiredArtifacts = [
    "workflow-log.md",
    "subagents-context.md",
    "implementation-report.md",
    "handoff.json",
    "learning-report.md",
  ];
  const missingArtifacts = requiredArtifacts.filter(
    (name) => !artifactExists(artifactDir, name),
  );
  const phaseComplete = Number(state.lastSafePhase) >= 12 &&
    Number(state.phase) === 12 &&
    state.phaseStatus === "DONE";
  return {
    taskCount: tasks.length,
    phaseComplete,
    incompleteTasks: incompleteTasks.map((task) => ({ id: task.id, status: task.status })),
    tasksWithoutEvidencePlan: tasksWithoutEvidencePlan.map((task) => task.id),
    unresolvedScope: unresolvedScope.map((task) => task.id),
    incompleteGates: incompleteGates.map((gate) => ({ id: gate.id, status: gate.status })),
    gatesWithoutEvidence: gatesWithoutEvidence.map((gate) => gate.id),
    missingArtifacts,
    complete:
      tasks.length > 0 &&
      phaseComplete &&
      incompleteTasks.length === 0 &&
      tasksWithoutEvidencePlan.length === 0 &&
      unresolvedScope.length === 0 &&
      incompleteGates.length === 0 &&
      gatesWithoutEvidence.length === 0 &&
      missingArtifacts.length === 0,
  };
}

export function updateRunStatus(artifactDir, status, options = {}) {
  const normalizedStatus = String(status ?? "").toUpperCase();
  if (!RUN_STATUS_SET.has(normalizedStatus)) {
    throw new OrchestrationStateError(
      "INVALID_RUN_STATUS",
      `Invalid run status: ${status}`,
    );
  }

  return withLock(artifactDir, () => {
    const state = loadRun(artifactDir, { repairSnapshot: true }).state;
    if (state.status === normalizedStatus && TERMINAL_RUN_STATUSES.has(normalizedStatus)) {
      return { changed: false, state, summary: runSummary(state) };
    }
    assertRunMutable(state, "update run status");
    assertRunTransition(state, normalizedStatus);
    if (normalizedStatus === "DONE") {
      const audit = completionAudit(artifactDir, state);
      if (!audit.complete) {
        throw new OrchestrationStateError(
          "RUN_COMPLETION_GATES_FAILED",
          `Run ${state.runId} cannot be DONE until tasks, scope, Phase 12, gates, evidence, and artifacts are complete`,
          audit,
        );
      }
    }
    let cancellation = state.cancellation ?? null;
    if (normalizedStatus === "CANCELLED") {
      const nonTerminalTasks = Object.values(state.tasks ?? {}).filter(
        (task) => !TERMINAL_TASK_STATUSES.has(task.status),
      );
      if (!cancellation?.requestedAt) {
        throw new OrchestrationStateError(
          "CANCELLATION_NOT_REQUESTED",
          "Request cancellation and reconcile executors before finalizing the run",
        );
      }
      if (nonTerminalTasks.length > 0) {
        throw new OrchestrationStateError(
          "CANCELLATION_NOT_RECONCILED",
          "Run cannot be CANCELLED while tasks remain non-terminal",
          { tasks: nonTerminalTasks.map((task) => ({ id: task.id, status: task.status })) },
        );
      }
      cancellation = {
        ...cancellation,
        pendingExecutorStops: [],
        finalizedAt: iso(options.now),
      };
    }
    const committed = commitEvent(
      artifactDir,
      state,
      "RUN_STATUS_UPDATED",
      {
        runStatus: normalizedStatus,
        statusReason: options.reason ?? null,
        cancellation,
      },
      options,
    );
    return { state: committed.state, event: committed.event, summary: runSummary(committed.state) };
  }, options);
}

export function findRunDirectory(options = {}) {
  if (options.artifactDir) return resolve(options.artifactDir);
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const root = join(projectRoot, ".orchestration");
  if (!existsSync(root)) {
    throw new OrchestrationStateError("RUN_NOT_FOUND", `No .orchestration directory in ${projectRoot}`);
  }

  const candidates = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    if (!existsSync(stateFile(directory)) && !existsSync(eventsFile(directory))) continue;
    const paths = [stateFile(directory), eventsFile(directory)].filter((path) => existsSync(path));
    const modifiedAt = Math.max(...paths.map((path) => statSync(path).mtimeMs));
    let identity = { runId: null, slug: entry.name };
    try {
      if (existsSync(stateFile(directory))) {
        const snapshot = safeJsonParse(readFileSync(stateFile(directory), "utf8"), stateFile(directory));
        identity = {
          runId: snapshot.runId ?? null,
          slug: snapshot.slug ?? entry.name,
        };
      } else if (existsSync(eventsFile(directory))) {
        const firstLine = readFileSync(eventsFile(directory), "utf8").split(/\r?\n/).find(Boolean);
        const firstEvent = firstLine ? JSON.parse(firstLine) : null;
        identity = {
          runId: firstEvent?.runId ?? firstEvent?.payload?.state?.runId ?? null,
          slug: firstEvent?.payload?.state?.slug ?? entry.name,
        };
      }
    } catch {
      // Keep the directory as a candidate. Loading below will surface RUN_CORRUPT
      // instead of silently selecting an older run.
    }
    candidates.push({ directory, identity, modifiedAt });
  }

  const matching = options.runId
    ? candidates.filter((candidate) =>
        candidate.identity.runId === options.runId ||
        candidate.identity.slug === options.runId ||
        basename(candidate.directory) === options.runId,
      )
    : candidates;
  if (matching.length === 0) {
    throw new OrchestrationStateError(
      "RUN_NOT_FOUND",
      options.runId ? `Run not found: ${options.runId}` : "No resumable orchestration run found",
    );
  }
  matching.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const valid = [];
  for (const candidate of matching) {
    try {
      const state = loadRun(candidate.directory).state;
      valid.push({ ...candidate, state });
      if (options.runId || ACTIVE_RUN_STATUSES.has(state.status)) return candidate.directory;
    } catch (error) {
      throw new OrchestrationStateError(
        "RUN_CORRUPT",
        `Orchestration run at ${candidate.directory} is corrupt; refusing to fall back to an older run`,
        {
          artifactDir: candidate.directory,
          causeCode: error?.code ?? "INVALID_STATE",
          cause: error?.message ?? String(error),
        },
      );
    }
  }
  return valid[0].directory;
}

export function verifyRun(artifactDir) {
  const loaded = loadRun(artifactDir, { verifyReplay: true });
  if (loaded.eventTailIncomplete) {
    throw new OrchestrationStateError(
      "TRUNCATED_EVENT_TAIL",
      "events.jsonl ends with an incomplete event; run resume/reconcile to repair it",
    );
  }
  if (loaded.snapshotRecovered) {
    throw new OrchestrationStateError(
      loaded.snapshotDiverged ? "SNAPSHOT_DIVERGED" : "SNAPSHOT_REPAIR_REQUIRED",
      loaded.snapshotDiverged
        ? "state.json differs from deterministic event replay"
        : "state.json is missing, invalid, or behind events.jsonl",
      { snapshotError: loaded.snapshotError },
    );
  }
  const state = loaded.state;
  const events = loaded.events;
  const lastEvent = events.at(-1) ?? null;
  const valid =
    lastEvent != null &&
    lastEvent.revision === state.revision &&
    lastEvent.eventId === state.lastEventId;
  if (!valid) {
    throw new OrchestrationStateError(
      "INTEGRITY_ERROR",
      "state.json does not match the last durable event",
      {
        stateRevision: state.revision,
        eventRevision: lastEvent?.revision ?? null,
        stateLastEventId: state.lastEventId,
        eventId: lastEvent?.eventId ?? null,
      },
    );
  }
  return {
    valid: true,
    artifactDir: resolve(artifactDir),
    snapshotRecovered: loaded.snapshotRecovered,
    eventCount: events.length,
    summary: runSummary(state),
  };
}

export function statusRun(artifactDir) {
  const loaded = loadRun(artifactDir, { verifyReplay: true });
  return {
    artifactDir: resolve(artifactDir),
    summary: runSummary(loaded.state),
    tasks: loaded.state.tasks,
    completionGates: loaded.state.completionGates,
    resume: loaded.state.resume,
    cancellation: loaded.state.cancellation,
    integrity: {
      snapshotRecovered: loaded.snapshotRecovered,
      snapshotDiverged: loaded.snapshotDiverged,
      eventTailIncomplete: loaded.eventTailIncomplete,
      snapshotError: loaded.snapshotError,
    },
  };
}
