import { createHash } from "node:crypto";

import { readTelemetry, recordTelemetry } from "./telemetry.mjs";

const AGY_MODELS = Object.freeze([
  "gemini-3.5-flash-low",
  "gemini-3.5-flash-medium",
  "gemini-3.5-flash-high",
  "gemini-3.1-pro-low",
  "gemini-3.1-pro-high",
]);
const AGY_MODEL_SET = new Set(AGY_MODELS);
const REVIEW_FAILURES = new Set(["FAIL", "FAILED", "CHANGES_REQUESTED"]);

export class AdaptiveRoutingError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "AdaptiveRoutingError";
    this.code = code;
    this.details = details;
  }
}

function normalize(value) {
  return String(value ?? "unknown").trim().toUpperCase();
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function isAgy(executor) {
  return /agy|antigravity/i.test(String(executor ?? "agy"));
}

function modelRank(model) {
  return AGY_MODELS.indexOf(model);
}

function nextModel(model) {
  const rank = modelRank(model);
  return rank >= 0 ? AGY_MODELS[Math.min(AGY_MODELS.length - 1, rank + 1)] : model;
}

function heuristicModel(context) {
  const text = [
    context.title,
    context.description,
    ...(context.files ?? []),
    ...(context.contractIds ?? []),
  ].filter(Boolean).join(" ");
  const taskType = normalize(context.taskType);
  const complexity = normalize(context.complexity);
  const review = taskType === "REVIEW_ONLY" || Boolean(context.review);
  const critical = Boolean(context.critical) || /security|auth|payment|critical|migration/i.test(text);
  const complexContract = Boolean(context.contractRequired) && ["HIGH", "CRITICAL"].includes(complexity);
  const complexUi = /complex form|wizard|state machine|realtime|real-time|drag.?drop/i.test(text);
  const designSystem = /tokens\.css|components\.html|DESIGN\.md|design[- ]system/i.test(text);
  if (review || critical) return { model: "gemini-3.1-pro-high", reason: review ? "review-floor" : "critical-risk-floor" };
  if (complexContract || complexUi || complexity === "HIGH") {
    return { model: "gemini-3.1-pro-low", reason: complexContract ? "complex-contract" : "high-complexity" };
  }
  if (designSystem || Boolean(context.highFidelity)) {
    return { model: "gemini-3.5-flash-high", reason: "visual-fidelity-floor" };
  }
  return { model: "gemini-3.5-flash-medium", reason: "default-front-end" };
}

function canonicalAttempts(events) {
  const attempts = events.filter((event) => event.eventType === "task_attempt_outcome");
  const attemptKeys = new Set(attempts.map((event) => `${event.runId}\0${event.taskId}`));
  const legacy = events.filter((event) =>
    event.eventType === "task_outcome" && !attemptKeys.has(`${event.runId}\0${event.taskId}`),
  );
  return [...attempts, ...legacy];
}

function isSuccess(event) {
  return event.result === "DONE" &&
    !REVIEW_FAILURES.has(normalize(event.reviewResult)) &&
    Number(event.regressions ?? 0) === 0;
}

function wilson(successes, total, z = 1.96) {
  if (total === 0) return { lower: 0, upper: 1 };
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return {
    lower: Math.max(0, (center - margin) / denominator),
    upper: Math.min(1, (center + margin) / denominator),
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function metricsByModel(events) {
  const groups = new Map();
  for (const event of events.filter((item) => AGY_MODEL_SET.has(item.model))) {
    const group = groups.get(event.model) ?? {
      model: event.model,
      samples: 0,
      successes: 0,
      firstPassSamples: 0,
      firstPassSuccesses: 0,
      reviewFailures: 0,
      regressions: 0,
      durations: [],
    };
    group.samples += 1;
    const success = isSuccess(event);
    if (success) group.successes += 1;
    if (Number(event.attempt ?? 1) === 1) {
      group.firstPassSamples += 1;
      if (success) group.firstPassSuccesses += 1;
    }
    if (REVIEW_FAILURES.has(normalize(event.reviewResult))) group.reviewFailures += 1;
    group.regressions += Number(event.regressions ?? 0);
    if (Number.isFinite(event.durationMs) && Number(event.durationMs) >= 0) {
      group.durations.push(Number(event.durationMs));
    }
    groups.set(event.model, group);
  }
  const allMedians = [...groups.values()].map((group) => median(group.durations)).filter(Number.isFinite);
  const fastest = allMedians.length ? Math.min(...allMedians) : null;
  return [...groups.values()].map((group) => {
    const quality = (group.successes + 2) / (group.samples + 4);
    const firstPass = (group.firstPassSuccesses + 1) / (group.firstPassSamples + 2);
    const interval = wilson(group.successes, group.samples);
    const medianDurationMs = median(group.durations);
    const speed = fastest != null && medianDurationMs != null ? Math.min(1, fastest / Math.max(1, medianDurationMs)) : 0.5;
    const reviewFailureRate = group.samples ? group.reviewFailures / group.samples : null;
    const regressionRate = group.samples ? group.regressions / group.samples : null;
    const score = (0.62 * quality) + (0.18 * firstPass) + (0.12 * speed) +
      (0.08 * (1 - Math.min(1, regressionRate ?? 0)));
    return {
      model: group.model,
      samples: group.samples,
      successes: group.successes,
      successRate: group.samples ? group.successes / group.samples : null,
      smoothedSuccessRate: quality,
      successWilson95: interval,
      firstPassSuccessRate: group.firstPassSamples
        ? group.firstPassSuccesses / group.firstPassSamples
        : null,
      reviewFailureRate,
      regressionRate,
      medianDurationMs,
      score,
    };
  }).sort((left, right) => modelRank(left.model) - modelRank(right.model));
}

export function adaptiveRoutingEvidence(projectRoot, context, options = {}) {
  const taskType = normalize(context.taskType);
  const complexity = normalize(context.complexity);
  const all = canonicalAttempts(readTelemetry(projectRoot)).filter((event) =>
    isAgy(event.executor) && normalize(event.taskType) === taskType,
  );
  const exact = all.filter((event) => normalize(event.complexity) === complexity);
  const minimumStratumSamples = Number(options.minimumStratumSamples ?? 10);
  const selected = exact.length >= minimumStratumSamples ? exact : all;
  return {
    evidenceLevel: exact.length >= minimumStratumSamples ? "task-type+complexity" : "task-type",
    exactSamples: exact.length,
    taskTypeSamples: all.length,
    models: metricsByModel(selected),
  };
}

export function routeModel(projectRoot, context, options = {}) {
  const executor = context.executor ?? "agy";
  if (!isAgy(executor)) {
    const effort = context.userEffort ?? (normalize(context.taskType) === "REVIEW_ONLY" || context.critical ? "high" : "medium");
    return {
      executor,
      effort,
      source: context.userEffort ? "user" : "heuristic",
      reason: "Codex routing keeps the account-default model and varies only effort",
      adaptive: false,
    };
  }
  if (context.userModel) {
    if (!AGY_MODEL_SET.has(context.userModel) && context.userModel !== "auto") {
      throw new AdaptiveRoutingError("MODEL_NOT_ALLOWED", `Unsupported AGY model override: ${context.userModel}`);
    }
    return {
      executor,
      model: context.userModel,
      source: "user",
      reason: "Explicit user override has priority over learned routing",
      adaptive: false,
    };
  }
  const heuristic = heuristicModel(context);
  let floor = heuristic.model;
  if (context.previousFailed && context.previousModel && AGY_MODEL_SET.has(context.previousModel)) {
    const escalated = nextModel(context.previousModel);
    if (modelRank(escalated) > modelRank(floor)) floor = escalated;
  }
  const evidence = adaptiveRoutingEvidence(projectRoot, context, options);
  const minimumSamples = Number(options.minimumSamples ?? 5);
  const baseline = evidence.models.find((item) => item.model === floor);
  const eligible = evidence.models.filter((item) =>
    item.samples >= minimumSamples && modelRank(item.model) >= modelRank(floor),
  );
  let selected = floor;
  let source = "heuristic";
  let reason = context.previousFailed && floor !== heuristic.model
    ? `Escalated one tier after a failed ${context.previousModel} attempt`
    : heuristic.reason;

  if (baseline?.samples >= minimumSamples && eligible.length > 1) {
    const best = [...eligible].sort((left, right) =>
      right.score - left.score ||
      right.successWilson95.lower - left.successWilson95.lower ||
      modelRank(left.model) - modelRank(right.model),
    )[0];
    const qualityImprovement = best.smoothedSuccessRate - baseline.smoothedSuccessRate;
    const scoreImprovement = best.score - baseline.score;
    const conservativeQuality = best.successWilson95.lower >= baseline.successWilson95.lower;
    if (best.model !== floor && qualityImprovement >= Number(options.minimumQualityGain ?? 0.03) &&
        scoreImprovement >= Number(options.minimumScoreGain ?? 0.02) && conservativeQuality) {
      selected = best.model;
      source = "adaptive";
      reason = `${best.model} outperformed ${floor} in the comparable historical stratum`;
    }
  }
  return {
    executor,
    model: selected,
    source,
    reason,
    adaptive: source === "adaptive",
    heuristicBaseline: heuristic.model,
    fidelityFloor: floor,
    thresholds: {
      minimumSamples,
      minimumStratumSamples: Number(options.minimumStratumSamples ?? 10),
      minimumQualityGain: Number(options.minimumQualityGain ?? 0.03),
      minimumScoreGain: Number(options.minimumScoreGain ?? 0.02),
    },
    evidence,
  };
}

export function recordRoutingDecision(projectRoot, decision, context, options = {}) {
  if (!options.runId || !options.taskId) {
    throw new AdaptiveRoutingError(
      "ROUTING_DECISION_ID_REQUIRED",
      "Persisted routing decisions require runId and taskId",
    );
  }
  const occurredAt = options.occurredAt ?? new Date().toISOString();
  const eventId = `route-${hash(`${options.runId}\0${options.taskId}\0${decision.model ?? decision.effort}\0${decision.source}`).slice(0, 24)}`;
  return recordTelemetry(projectRoot, {
    eventId,
    eventType: "routing_decision",
    occurredAt,
    runId: options.runId,
    taskId: options.taskId,
    taskType: context.taskType ?? null,
    complexity: context.complexity ?? null,
    executor: decision.executor ?? null,
    model: decision.model ?? null,
    attempt: Number(options.attempt ?? 0),
    result: "SELECTED",
    metadata: {
      source: decision.source,
      reason: decision.reason,
      heuristicBaseline: decision.heuristicBaseline ?? null,
      fidelityFloor: decision.fidelityFloor ?? null,
      historicalSamples: decision.evidence?.taskTypeSamples ?? 0,
    },
  });
}

export function adaptiveRoutingReport(projectRoot, options = {}) {
  const events = canonicalAttempts(readTelemetry(projectRoot)).filter((event) => isAgy(event.executor));
  const dimensions = new Map();
  for (const event of events) {
    const key = `${normalize(event.taskType)}\0${normalize(event.complexity)}`;
    const group = dimensions.get(key) ?? { taskType: event.taskType, complexity: event.complexity, events: [] };
    group.events.push(event);
    dimensions.set(key, group);
  }
  return {
    samples: events.length,
    minimumSamples: Number(options.minimumSamples ?? 5),
    strata: [...dimensions.values()].map((group) => ({
      taskType: group.taskType,
      complexity: group.complexity,
      samples: group.events.length,
      models: metricsByModel(group.events),
    })).sort((left, right) => right.samples - left.samples),
  };
}
