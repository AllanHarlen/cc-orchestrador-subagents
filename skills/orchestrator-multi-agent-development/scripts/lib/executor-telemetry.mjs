import { existsSync, readFileSync } from "node:fs";

/**
 * Leitores deterministicos dos logs que as CLIs externas (AGY, Codex) ja
 * produzem — nunca escrevem em nada, so leem e normalizam.
 *
 * Origem do achado (analise-run-oficina-saas-20260905.md, Achado 2): a
 * telemetria por task ficou vazia em 33/33 tasks de uma run real porque a
 * Fase 6 (monitoring) nunca lia de volta o que as CLIs ja tinham publicado —
 * `conversationId` do AGY estava no log do bridge (`bridge.agy.args.built`),
 * o modelo resolvido estava em `bridge.model.resolved`, o thread id do Codex
 * estava no `.log` de cada job. Os dados existiam; ninguem os lia de volta.
 *
 * `readAgyBridgeEvents` prefere `bridge.exit` (adicionado no fix do
 * Achado 7/8 em `cc-antigravity-plugin`) como fonte primaria — e o unico
 * evento garantido em toda invocacao, com exitCode/duracao/modelo/
 * conversationId/classificacao num unico lugar. Cai para os eventos
 * anteriores (`bridge.model.resolved`, `bridge.agy.args.built`,
 * `bridge.output.file`) para logs de antes desse fix.
 */

/** Le um arquivo JSONL tolerando linhas malformadas — nunca lanca. */
function readJsonlSafe(path) {
  if (!existsSync(path)) return [];
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const lines = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // Linha corrompida (escrita parcial, truncamento) — pula, nunca lanca.
    }
  }
  return lines;
}

/** `--conversation <id>` (ou `--continue`) dentro do array de args resumido do bridge. */
function extractConversationIdFromArgs(args) {
  if (!Array.isArray(args)) return null;
  const index = args.indexOf("--conversation");
  if (index >= 0 && typeof args[index + 1] === "string") return args[index + 1];
  return null;
}

/**
 * Extrai a telemetria de uma invocacao do bridge AGY a partir do log JSONL
 * do plugin (`%LOCALAPPDATA%/agy/cc-plugin-logs/plugin-<data>.jsonl`, ou
 * `CC_ANTIGRAVITY_LOG_PATH`).
 *
 * @param {string} logPath
 * @param {object} [options]
 * @param {number} [options.pid]     PID do processo do bridge, se conhecido —
 *                                    filtra o log a essa invocacao especifica
 *                                    (o log e compartilhado por todo o dia).
 * @param {string} [options.since]   ISO timestamp — ignora eventos anteriores.
 * @returns {{
 *   pid: number|null,
 *   conversationId: string|null,
 *   resolvedModel: string|null,
 *   startedAt: string|null,
 *   finishedAt: string|null,
 *   durationMs: number|null,
 *   exitCode: number|null,
 *   outputBytes: number|null,
 *   classified: string|null,
 * }}
 */
export function readAgyBridgeEvents(logPath, options = {}) {
  const all = readJsonlSafe(logPath);
  const sinceMs = options.since ? Date.parse(options.since) : null;
  const matching = all.filter((line) => {
    if (options.pid != null && line.pid !== options.pid) return false;
    if (sinceMs != null) {
      const ts = Date.parse(line.timestamp ?? "");
      if (Number.isFinite(ts) && ts < sinceMs) return false;
    }
    return true;
  });

  const byEvent = (name) => matching.find((line) => line.event === name);
  const start = byEvent("bridge.start") ?? byEvent("bridge.args.parsed");
  const modelResolved = byEvent("bridge.model.resolved");
  const argsBuilt = byEvent("bridge.agy.args.built");
  const outputFile = byEvent("bridge.output.file");
  const classified = byEvent("bridge.classified");
  const exit = byEvent("bridge.exit");

  const startedAt = start?.timestamp ?? null;
  const finishedAt = exit?.timestamp ?? classified?.timestamp ?? outputFile?.timestamp ?? null;
  const startedMs = Date.parse(startedAt ?? "");
  const finishedMs = Date.parse(finishedAt ?? "");

  return {
    pid: matching[0]?.pid ?? options.pid ?? null,
    conversationId:
      exit?.conversationId ??
      classified?.conversationId ??
      extractConversationIdFromArgs(argsBuilt?.args) ??
      null,
    resolvedModel: exit?.model ?? modelResolved?.model ?? argsBuilt?.model ?? null,
    startedAt,
    finishedAt,
    durationMs: Number.isFinite(exit?.durationMs)
      ? exit.durationMs
      : Number.isFinite(startedMs) && Number.isFinite(finishedMs)
        ? Math.max(0, finishedMs - startedMs)
        : null,
    exitCode: exit?.exitCode ?? null,
    outputBytes: exit?.outputBytes ?? outputFile?.bytes ?? null,
    classified: exit?.classified ?? classified?.type ?? null,
  };
}

/**
 * Le o sidecar de job do Codex (`~/.claude/plugins/data/codex-openai-codex/
 * state/<task>/jobs/<id>.json`), publicado por `codex-companion.mjs`.
 *
 * Formato tolerante — nomes de campo variam entre versoes do companion — por
 * isso os fallbacks: `threadId`/`thread_id`, `startedAt`/`created_at`,
 * `finishedAt`/`completed_at`.
 *
 * @param {string} jobPath
 * @returns {{ jobId: string|null, threadId: string|null, status: string|null,
 *   model: string|null, effort: string|null, startedAt: string|null,
 *   finishedAt: string|null }|null}  `null` quando o arquivo nao existe ou
 *   nao parseia — nunca lanca.
 */
export function readCodexJob(jobPath) {
  if (!existsSync(jobPath)) return null;
  let job;
  try {
    job = JSON.parse(readFileSync(jobPath, "utf8"));
  } catch {
    return null;
  }
  if (!job || typeof job !== "object") return null;
  return {
    jobId: job.jobId ?? job.job_id ?? null,
    threadId: job.threadId ?? job.thread_id ?? null,
    status: job.status ?? null,
    model: job.model ?? job.requestedModel ?? null,
    effort: job.effort ?? job.reasoningEffort ?? job.reasoning_effort ?? null,
    startedAt: job.startedAt ?? job.created_at ?? job.createdAt ?? null,
    finishedAt: job.finishedAt ?? job.completed_at ?? job.completedAt ?? null,
  };
}

/**
 * Le `thread_settings_applied` do rollout de sessao do Codex
 * (`~/.codex/sessions/YYYY/MM/DD/*.jsonl`) — o **modelo efetivamente
 * resolvido**, distinto do que o orquestrador pediu. E a evidencia direta do
 * Achado 13: `~/.codex/config.toml` define `model = "gpt-5.6-sol"` (papel
 * review) como default de conta, e sem `--model` explicito toda dispatch cai
 * nesse default — o rollout e onde isso fica visivel depois do fato.
 *
 * Aceita tanto o evento com os campos no nivel raiz (`{"type":
 * "thread_settings_applied","model":"gpt-5.6-sol",...}`) quanto aninhados
 * sob `settings`/`payload`, para tolerar variacao de formato entre versoes
 * do runtime Codex.
 *
 * @param {string} rolloutPath
 * @returns {{ model: string|null, reasoningEffort: string|null,
 *   approvalPolicy: string|null }|null}
 */
export function readCodexRollout(rolloutPath) {
  const lines = readJsonlSafe(rolloutPath);
  const event = lines.find(
    (line) => line?.type === "thread_settings_applied" || line?.event === "thread_settings_applied",
  );
  if (!event) return null;
  const source = event.settings ?? event.payload ?? event;
  return {
    model: source.model ?? null,
    reasoningEffort: source.reasoning_effort ?? source.reasoningEffort ?? null,
    approvalPolicy: source.approval_policy ?? source.approvalPolicy ?? null,
  };
}
