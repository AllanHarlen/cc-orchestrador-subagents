const CANONICAL = new Set([
  "PENDING",
  "RUNNING",
  "DONE",
  "FAILED",
  "BLOCKED",
  "STALLED",
  "CANCELLED",
  "UNKNOWN",
  "QUOTA_EXHAUSTED",
  "QUOTA_EXAUSTED",
  "AUTH_REQUIRED",
  "AGY_MISSING",
  "TIMEOUT",
  "NEEDS_SYNC",
]);

const STATUS_ALIASES = new Map([
  ["COMPLETED", "DONE"],
  ["COMPLETE", "DONE"],
  ["SUCCESS", "DONE"],
  ["SUCCEEDED", "DONE"],
  ["IN_PROGRESS", "RUNNING"],
  ["IN PROGRESS", "RUNNING"],
  ["DISPATCHED", "RUNNING"],
  ["QUEUED", "PENDING"],
  ["ERROR", "FAILED"],
  ["TIMED_OUT", "TIMEOUT"],
  ["TIMED OUT", "TIMEOUT"],
  ["STOPPED", "CANCELLED"],
]);

function firstValue(object, keys) {
  for (const key of keys) {
    if (object?.[key] != null) return object[key];
  }
  return null;
}

function bounded(value, max = 2_000) {
  if (value == null) return null;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function statusFromText(text) {
  const explicit = text.match(/(?:^|\n)\s*(?:Status|Estado)\s*:\s*([A-Z_ ]+)/i)?.[1]?.trim().toUpperCase();
  if (explicit) return STATUS_ALIASES.get(explicit) ?? (CANONICAL.has(explicit) ? explicit : null);
  const patterns = [
    [/quota|rate limit|resource exhausted|daily limit/i, "QUOTA_EXHAUSTED"],
    [/auth(?:entication)? required|login required|unauthorized/i, "AUTH_REQUIRED"],
    [/agy.+(?:not found|missing)|command not found.+agy/i, "AGY_MISSING"],
    [/timed? out|timeout/i, "TIMEOUT"],
    [/cancelled|canceled|interrupted/i, "CANCELLED"],
    [/\b(?:failed|failure|error)\b/i, "FAILED"],
  ];
  return patterns.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function normalizeStatus(raw, text, executor) {
  const explicit = String(raw ?? "").trim().toUpperCase();
  let normalized = STATUS_ALIASES.get(explicit) ?? explicit;
  if (!CANONICAL.has(normalized)) normalized = statusFromText(text);
  if (executor === "agy" && normalized === "QUOTA_EXHAUSTED") return "QUOTA_EXAUSTED";
  return normalized && CANONICAL.has(normalized) ? normalized : "UNKNOWN";
}

function normalizeFiles(value) {
  if (value == null) return [];
  const entries = Array.isArray(value) ? value : [value];
  return [...new Set(entries.map((entry) =>
    typeof entry === "string" ? entry : entry?.path,
  ).filter(Boolean).map(String))];
}

function normalizeValidations(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === "string") return { command: entry, status: "UNKNOWN" };
    return {
      command: entry.command ?? entry.name ?? "validation",
      status: String(entry.status ?? (entry.passed === true ? "PASS" : entry.passed === false ? "FAIL" : "UNKNOWN")).toUpperCase(),
      evidenceId: entry.evidenceId ?? entry.evidence_id ?? null,
    };
  });
}

export function adaptExecutorProbe(executor, rawInput, options = {}) {
  const normalizedExecutor = String(executor ?? "").toLowerCase();
  if (!new Set(["codex", "agy"]).has(normalizedExecutor)) {
    const error = new Error(`Unsupported executor adapter: ${executor}`);
    error.code = "UNSUPPORTED_EXECUTOR_ADAPTER";
    throw error;
  }
  const raw = typeof rawInput === "string" ? { output: rawInput } : (rawInput ?? {});
  const text = [
    raw.output,
    raw.result,
    raw.message,
    raw.reason,
    raw.error,
    raw.summary,
  ].map((value) => bounded(value)).filter(Boolean).join("\n");
  const status = normalizeStatus(
    firstValue(raw, ["executorStatus", "status", "state", "resultStatus", "result_status"]),
    text,
    normalizedExecutor,
  );
  const reasonCode = [
    "QUOTA_EXHAUSTED",
    "QUOTA_EXAUSTED",
    "AUTH_REQUIRED",
    "AGY_MISSING",
    "TIMEOUT",
    "NEEDS_SYNC",
  ].includes(status) ? status : firstValue(raw, ["reasonCode", "reason_code"]);
  const sessionId = normalizedExecutor === "codex"
    ? firstValue(raw, ["sessionId", "session_id", "jobId", "job_id", "taskId", "task_id"])
    : null;
  const conversationId = normalizedExecutor === "agy"
    ? firstValue(raw, ["conversationId", "conversation_id", "sessionId", "session_id"])
    : null;
  const rawApiCalls = firstValue(raw, ["apiCalls", "api_calls"]);
  const rawToolCalls = firstValue(raw, ["toolCalls", "tool_calls"]);
  const probe = {
    executorStatus: status,
    reasonCode: reasonCode ?? null,
    reason: bounded(firstValue(raw, ["reason", "message", "summary"]) ?? text),
    error: bounded(firstValue(raw, ["error", "stderr"])),
    sessionId,
    conversationId,
    model: firstValue(raw, ["model", "modelName", "model_name"]),
    lastActivityAt: firstValue(raw, ["lastActivityAt", "last_activity_at", "updatedAt", "updated_at"]),
    completedAt: firstValue(raw, ["completedAt", "completed_at", "finishedAt", "finished_at"]),
    apiCalls: rawApiCalls == null ? undefined : Number(rawApiCalls),
    toolCalls: rawToolCalls == null ? undefined : Number(rawToolCalls),
    currentTool: firstValue(raw, ["currentTool", "current_tool"]),
    producedFiles: normalizeFiles(firstValue(raw, ["producedFiles", "produced_files", "files", "changedFiles"])),
    validations: normalizeValidations(firstValue(raw, ["validations", "checks", "tests"])),
    commitAfter: firstValue(raw, ["commitAfter", "commit_after", "commit", "head"]),
    adapter: {
      executor: normalizedExecutor,
      version: 1,
      authoritative: Boolean(options.authoritative ?? raw.authoritative ?? status !== "UNKNOWN"),
      rawStatus: firstValue(raw, ["executorStatus", "status", "state", "resultStatus", "result_status"]),
    },
  };
  if (status === "UNKNOWN") {
    probe.reasonCode = probe.reasonCode ?? "EXECUTOR_STATUS_UNKNOWN";
    probe.adapter.authoritative = false;
  }
  return probe;
}

export function adaptProbeSet(input, options = {}) {
  if (!input || typeof input !== "object") {
    const error = new Error("Executor input must be an object");
    error.code = "INVALID_EXECUTOR_INPUT";
    throw error;
  }
  const tasks = {};
  const source = input.tasks ?? input;
  for (const [taskId, raw] of Object.entries(source)) {
    const executor = raw.executor ?? options.executor;
    tasks[String(taskId).toUpperCase()] = adaptExecutorProbe(executor, raw, options);
  }
  return { schemaVersion: 1, tasks };
}
