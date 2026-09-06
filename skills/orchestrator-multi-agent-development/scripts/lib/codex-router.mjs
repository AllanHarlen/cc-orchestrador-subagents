/**
 * Vocabulario de modelo do Codex: papeis fixos, roteamento por natureza da
 * task e effort derivado de complexidade/risco.
 *
 * Modulo puro, espelhando o papel que `ROUTER_AGY_MODELS` / `LOW_TIER_AGY_MODELS`
 * (`validate-routing.mjs`) cumprem do lado AGY. Os slugs ficam numa constante
 * unica e versionada aqui — nao sao lidos de `~/.codex/models_cache.json` em
 * tempo de validacao, para o gate continuar deterministico.
 *
 * Origem do achado: a run oficina-saas-20260905-001 rodou 10 das 11 threads
 * Codex com `gpt-5.6-sol` (o modelo de review) fazendo implementacao, porque
 * o plugin nunca passou `--model` ao Codex e nao existia onde expressar essa
 * intencao na classificacao. Ver analise-run-oficina-saas-20260905.md, Achado 13.
 */

import { TASK_CATEGORIES } from "./project-config.mjs";

/**
 * Papel do Codex e o modelo fixo que o exerce.
 *
 * - `review`: fases 8/9 (review de codigo) e task REVIEW_ONLY.
 * - `implement`: BACKEND_ONLY, DATABASE_ONLY, DOCS_ONLY e a fatia back-end de
 *   FULLSTACK — desenvolvimento geral.
 * - `fix`: correcao originada da Fase 9.5 (browser-e2e) ou de review REPROVADO.
 */
export const CODEX_MODEL_ROLES = Object.freeze({
  review: "gpt-5.6-sol",
  implement: "gpt-5.6-terra",
  fix: "gpt-5.6-luna",
});

export const CODEX_ROLES = Object.freeze(Object.keys(CODEX_MODEL_ROLES));

/** Modelo -> papel, derivado de CODEX_MODEL_ROLES (para validacao reversa). */
export const CODEX_ROLE_BY_MODEL = Object.freeze(
  Object.fromEntries(Object.entries(CODEX_MODEL_ROLES).map(([role, model]) => [model, role])),
);

/**
 * Papel do Codex esperado por categoria de task, quando a origem e o plano
 * (nao uma correcao). REVIEW_ONLY -> review; as categorias de implementacao
 * -> implement. FRONTEND_ONLY nunca usa Codex (fica de fora do mapa).
 */
export const CODEX_ROLE_BY_CATEGORY = Object.freeze({
  BACKEND_ONLY: "implement",
  DATABASE_ONLY: "implement",
  DOCS_ONLY: "implement",
  FULLSTACK: "implement",
  REVIEW_ONLY: "review",
});

/** Origens de task que sempre mapeiam para o papel `fix`, independente da categoria. */
const FIX_ORIGINS = new Set(["review-fix", "e2e-fix"]);

/**
 * Efforts aceitos, na mesma forma do AGY (`agyEffort`): low, medium, high.
 * Nao ha default fixo — o Achado 13 mostrou que o `--effort medium` fixo do
 * orquestrador rebaixava em silencio o `model_reasoning_effort: "high"` do
 * config do usuario. Effort e sempre derivado da task.
 */
export const CODEX_EFFORT_LEVELS = Object.freeze(["low", "medium", "high"]);

/**
 * Papel do Codex esperado para uma task, dado sua categoria e origem.
 *
 * @param {object} params
 * @param {string} params.category  Uma de TASK_CATEGORIES.
 * @param {string} [params.origin]  "plan" (default) | "review-fix" | "e2e-fix".
 * @returns {string|null}  Um de CODEX_ROLES, ou null se a categoria nao usa Codex
 *                          (ex.: FRONTEND_ONLY).
 */
export function codexRoleForTask({ category, origin = "plan" } = {}) {
  if (!TASK_CATEGORIES.includes(category)) {
    throw new RangeError(`Unknown task category ${JSON.stringify(category)}; accepted: ${TASK_CATEGORIES.join(", ")}`);
  }
  if (origin !== "plan" && !FIX_ORIGINS.has(origin)) {
    throw new RangeError(`Unknown origin ${JSON.stringify(origin)}; accepted: plan, review-fix, e2e-fix`);
  }
  if (FIX_ORIGINS.has(origin)) return "fix";
  return CODEX_ROLE_BY_CATEGORY[category] ?? null;
}

/** Modelo fixo para um papel do Codex. Lanca RangeError para papel desconhecido. */
export function codexModelForRole(role) {
  const model = CODEX_MODEL_ROLES[role];
  if (!model) {
    throw new RangeError(`Unknown Codex role ${JSON.stringify(role)}; accepted: ${CODEX_ROLES.join(", ")}`);
  }
  return model;
}

/**
 * Effort derivado de complexidade/risco declarados na classificacao da task —
 * nunca um valor fixo. Espelha a mesma logica de "piso minimo" que o AGY usa
 * para model tier (ver "Roteamento por fidelidade de design" no SKILL.md),
 * aplicada a effort em vez de modelo.
 *
 * @param {object} params
 * @param {string} [params.complexity]  "low" | "medium" | "high" (como declarado
 *                                      na classificacao da task).
 * @param {boolean} [params.highRisk]   Task marcada de risco alto de regressao
 *                                      (ex.: fluxo de pagamento, autenticacao).
 * @returns {string}  Um de CODEX_EFFORT_LEVELS.
 */
export function codexEffortForTask({ complexity, highRisk = false } = {}) {
  if (highRisk) return "high";
  const normalized = String(complexity ?? "").toLowerCase();
  if (normalized === "high") return "high";
  if (normalized === "low") return "low";
  return "medium";
}

/** True quando `model` e um dos tres slugs fixos de CODEX_MODEL_ROLES. */
export function isKnownCodexModel(model) {
  return Object.prototype.hasOwnProperty.call(CODEX_ROLE_BY_MODEL, model);
}
