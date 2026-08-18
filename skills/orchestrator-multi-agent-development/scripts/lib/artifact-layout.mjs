import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Resolucao de caminho dos artefatos de uma run.
 *
 * Layout 1 (runs criadas antes desta versao): todos os artefatos na raiz de
 * `.orchestration/<slug>/`.
 *
 * Layout 2: artefatos agrupados por estagio do workflow (`plan/`, `contracts/`,
 * `run/`, `review/`, `report/`, `evidence/`, `learning/`).
 *
 * `state.json`, `events.jsonl` e `.state.lock` permanecem na raiz nos dois
 * layouts: a descoberta de run (`nextRunId`, `resume`, projecao de history e de
 * knowledge) varre filhos diretos de `.orchestration/` procurando `state.json`,
 * e o lock precisa ser previsivel antes de qualquer leitura de snapshot.
 *
 * Leitura sempre tenta layout 2 e cai para layout 1, para que uma run antiga
 * continue legivel e para que um artefato colocado manualmente no lugar antigo
 * nao desapareca dos gates. Escrita usa o layout declarado em
 * `state.layoutVersion`, e nunca duplica um artefato que ja existe no outro
 * layout.
 */

export const ARTIFACT_LAYOUT_VERSION = 2;
export const SUPPORTED_ARTIFACT_LAYOUT_VERSIONS = Object.freeze([1, 2]);

const LAYOUT_ROOT_FILES = Object.freeze(["state.json", "events.jsonl", ".state.lock"]);

const LAYOUT_V2_FILE_DIRECTORIES = Object.freeze({
  "tasks-classification.md": "plan",
  "waves.md": "plan",
  "monitoring.md": "run",
  "lifecycle-probe.json": "run",
  "reconciliation-probe.json": "run",
  "review-final.md": "review",
  "review-frontend.md": "review",
  "browser-e2e-report.md": "review",
  "e2e-report.md": "review",
  "e2e-verification.md": "review",
  "implementation-report.md": "report",
  "workflow-log.md": "report",
  "subagents-context.md": "report",
  "handoff.json": "report",
  "learning-report.md": "learning",
});

const LAYOUT_V2_TREE_DIRECTORIES = Object.freeze({
  contracts: "contracts",
  evidence: "evidence",
  "executor-results": "run/executor-results",
  prompts: "run/prompts",
  screenshots: "review/screenshots",
});

const LAYOUT_V2_DIRECTORIES = Object.freeze([
  "plan",
  "contracts",
  "run",
  "run/executor-results",
  "run/prompts",
  "review",
  "review/screenshots",
  "report",
  "evidence",
  "learning",
]);

function normalizeLayoutVersion(value) {
  const parsed = Number(value);
  return SUPPORTED_ARTIFACT_LAYOUT_VERSIONS.includes(parsed) ? parsed : 1;
}

function toAbsolute(artifactDir, relativePath) {
  return join(resolve(artifactDir), ...String(relativePath).split("/"));
}

function unique(values) {
  return [...new Set(values)];
}

/** Nome canonico -> caminho relativo dentro do diretorio da run. */
export function artifactRelativePath(name, layoutVersion = ARTIFACT_LAYOUT_VERSION) {
  const file = String(name);
  if (LAYOUT_ROOT_FILES.includes(file)) return file;
  if (normalizeLayoutVersion(layoutVersion) !== 2) return file;
  const directory = LAYOUT_V2_FILE_DIRECTORIES[file];
  return directory ? `${directory}/${file}` : file;
}

/** Chave de arvore (`evidence`, `executor-results`, ...) -> caminho relativo. */
export function artifactTreeRelativePath(key, layoutVersion = ARTIFACT_LAYOUT_VERSION) {
  const id = String(key);
  if (normalizeLayoutVersion(layoutVersion) !== 2) return id;
  return LAYOUT_V2_TREE_DIRECTORIES[id] ?? id;
}

export function artifactLayoutDirectories(layoutVersion = ARTIFACT_LAYOUT_VERSION) {
  return normalizeLayoutVersion(layoutVersion) === 2 ? [...LAYOUT_V2_DIRECTORIES] : [];
}

/** Candidatos de leitura, em ordem de preferencia: layout 2 e depois layout 1. */
export function artifactCandidatePaths(artifactDir, name) {
  return unique([
    artifactRelativePath(name, 2),
    artifactRelativePath(name, 1),
  ]).map((relativePath) => ({ relativePath, path: toAbsolute(artifactDir, relativePath) }));
}

/** Primeiro candidato existente, ou `null`. */
export function resolveArtifact(artifactDir, name) {
  for (const candidate of artifactCandidatePaths(artifactDir, name)) {
    if (existsSync(candidate.path)) return candidate;
  }
  return null;
}

export function artifactExists(artifactDir, name) {
  return resolveArtifact(artifactDir, name) != null;
}

/**
 * Caminho de escrita. Se o artefato ja existe em qualquer layout, reusa esse
 * caminho para nao criar duas copias divergentes na mesma run.
 */
export function artifactWritePath(artifactDir, name, layoutVersion = null) {
  const existing = resolveArtifact(artifactDir, name);
  if (existing) return existing;
  const version = layoutVersion ?? detectArtifactLayout(artifactDir);
  const relativePath = artifactRelativePath(name, version);
  return { relativePath, path: toAbsolute(artifactDir, relativePath) };
}

/** Diretorio de arvore existente, ou o caminho de escrita do layout corrente. */
export function artifactTreePath(artifactDir, key, layoutVersion = null) {
  for (const relativePath of unique([
    artifactTreeRelativePath(key, 2),
    artifactTreeRelativePath(key, 1),
  ])) {
    const path = toAbsolute(artifactDir, relativePath);
    if (existsSync(path)) return { relativePath, path };
  }
  const version = layoutVersion ?? detectArtifactLayout(artifactDir);
  const relativePath = artifactTreeRelativePath(key, version);
  return { relativePath, path: toAbsolute(artifactDir, relativePath) };
}

/**
 * Layout declarado pela run. Snapshot sem `layoutVersion` e uma run criada
 * antes desta versao, portanto layout 1. Snapshot ausente ou ilegivel cai na
 * inferencia por diretorio, para que `init` e ferramentas externas funcionem
 * antes do primeiro evento.
 */
export function detectArtifactLayout(artifactDir) {
  const root = resolve(artifactDir);
  const statePath = join(root, "state.json");
  if (existsSync(statePath)) {
    try {
      const snapshot = JSON.parse(readFileSync(statePath, "utf8"));
      if (snapshot?.layoutVersion != null) return normalizeLayoutVersion(snapshot.layoutVersion);
      return 1;
    } catch {
      // snapshot danificado: nao presuma layout pelo erro, use a inferencia abaixo
    }
  }
  if (existsSync(join(root, "plan")) || existsSync(join(root, "report"))) return 2;
  // Run em andamento sem snapshot legivel: nao reorganize no meio do caminho.
  if (existsSync(join(root, "events.jsonl"))) return 1;
  return ARTIFACT_LAYOUT_VERSION;
}

export function ensureArtifactLayout(artifactDir, layoutVersion = ARTIFACT_LAYOUT_VERSION) {
  const root = resolve(artifactDir);
  for (const directory of artifactLayoutDirectories(layoutVersion)) {
    mkdirSync(join(root, ...directory.split("/")), { recursive: true });
  }
  return root;
}
