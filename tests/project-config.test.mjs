import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_PROJECT_CONFIG,
  EXECUTORS,
  EXECUTOR_REQUIRED_CLI,
  PROJECT_CONFIG_DIRECTORY,
  PROJECT_CONFIG_FILENAME,
  PROJECT_CONFIG_QUESTIONS,
  PROJECT_CONFIG_QUESTION_ORDER,
  PROJECT_CONFIG_RELATIVE_PATH,
  PROJECT_CONFIG_SCHEMA_VERSION,
  ProjectConfigError,
  ROLES,
  diffProjectConfig,
  parseProjectConfig,
  projectConfigPath,
  projectConfigQuestions,
  readProjectConfig,
  renderProjectConfig,
  writeProjectConfig,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/project-config.mjs";

const temporaryRoots = [];

function projectRoot() {
  const root = mkdtempSync(join(process.cwd(), ".tmp-project-config-test-"));
  temporaryRoots.push(root);
  return root;
}

test.afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

const VALID_CONFIG = Object.freeze({
  schemaVersion: PROJECT_CONFIG_SCHEMA_VERSION,
  updatedAt: "2026-02-14T18:05:31Z",
  backendExecutor: "codex",
  frontendExecutor: "agy",
  backendReviewer: "codex",
  frontendReviewer: "agy",
});

const VALID_FILE = [
  "# ORCHESTRATOR PROJECT CONFIG",
  "",
  "- **schemaVersion**: 1",
  "- **updatedAt**: 2026-02-14T18:05:31Z",
  "- **backendExecutor**: codex",
  "- **frontendExecutor**: agy",
  "- **backendReviewer**: codex",
  "- **frontendReviewer**: agy",
  "",
].join("\n");

function fileWithout(field) {
  return VALID_FILE.split("\n")
    .filter((line) => !line.startsWith(`- **${field}**`))
    .join("\n");
}

/** Captura o erro lancado por `fn` (assert.throws nao devolve o erro). */
function captureError(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  assert.fail("expected the call to throw");
  return null;
}

function fileWith(field, value) {
  return VALID_FILE.split("\n")
    .map((line) => (line.startsWith(`- **${field}**`) ? `- **${field}**: ${value}` : line))
    .join("\n");
}

// --- Caminho canonico do arquivo (Req 3.1) ---------------------------------

test("canonical project config path is <root>/.orchestrator/project-config.md", () => {
  const root = projectRoot();

  assert.equal(PROJECT_CONFIG_DIRECTORY, ".orchestrator");
  assert.equal(PROJECT_CONFIG_FILENAME, "project-config.md");
  assert.equal(PROJECT_CONFIG_RELATIVE_PATH, ".orchestrator/project-config.md");
  assert.equal(projectConfigPath(root), join(root, ".orchestrator", "project-config.md"));
});

test("writeProjectConfig persists the file at the canonical path and reads it back", () => {
  const root = projectRoot();
  const written = writeProjectConfig(root, VALID_CONFIG, { now: "2026-02-14T18:05:31Z" });

  assert.equal(written.path, join(root, ".orchestrator", "project-config.md"));
  assert.ok(existsSync(written.path), "config file must exist after write");
  assert.equal(readFileSync(written.path, "utf8"), written.content);

  const loaded = readProjectConfig(root);
  assert.equal(loaded.exists, true);
  assert.equal(loaded.source, "file");
  assert.equal(loaded.path, written.path);
  for (const role of ROLES) assert.equal(loaded.config[role], VALID_CONFIG[role]);
  assert.equal(loaded.config.updatedAt, "2026-02-14T18:05:31Z");
});

test("readProjectConfig falls back to the default stack when the file is absent", () => {
  const root = projectRoot();
  const loaded = readProjectConfig(root);

  assert.equal(loaded.exists, false);
  assert.equal(loaded.source, "default");
  assert.equal(loaded.path, projectConfigPath(root));
  for (const role of ROLES) assert.equal(loaded.config[role], DEFAULT_PROJECT_CONFIG[role]);
});

// --- Tabela de opcoes e defaults por papel (Req 2.2 a 2.6, 2.10) -----------

test("question table exposes the allowed options and the default option of each role", () => {
  const expected = {
    backendExecutor: { options: ["codex", "claude-code"], defaultOption: "codex" },
    frontendExecutor: { options: ["agy", "claude-code"], defaultOption: "agy" },
    frontendReviewer: { options: ["agy", "codex", "claude-code"], defaultOption: "agy" },
    backendReviewer: { options: ["codex", "agy", "claude-code"], defaultOption: "codex" },
  };

  assert.deepEqual(PROJECT_CONFIG_QUESTION_ORDER, [
    "backendExecutor",
    "frontendExecutor",
    "frontendReviewer",
    "backendReviewer",
  ]);
  assert.deepEqual(
    projectConfigQuestions().map((question) => question.role),
    [...PROJECT_CONFIG_QUESTION_ORDER],
  );

  for (const [role, spec] of Object.entries(expected)) {
    const question = PROJECT_CONFIG_QUESTIONS[role];
    assert.ok(question, `question for ${role} must exist`);
    assert.deepEqual(question.options.map((option) => option.value), spec.options);
    assert.equal(question.defaultOption, spec.defaultOption);
    assert.equal(question.defaultOption, DEFAULT_PROJECT_CONFIG[role]);

    const defaults = question.options.filter((option) => option.isDefault);
    assert.deepEqual(defaults.map((option) => option.value), [spec.defaultOption]);
    for (const option of question.options) assert.ok(EXECUTORS.includes(option.value));
  }
});

test("each option announces the role of the agent and the CLI it requires", () => {
  for (const question of projectConfigQuestions()) {
    assert.ok(question.title.length > 0, `${question.role} must have a title`);
    assert.ok(question.roleDescription.length > 0, `${question.role} must describe the role`);

    for (const option of question.options) {
      assert.equal(option.requiresCli, EXECUTOR_REQUIRED_CLI[option.value]);
      if (option.requiresCli === null) {
        assert.match(option.description, /Claude Code/);
        assert.doesNotMatch(option.description, /Exige a CLI/);
      } else {
        assert.ok(
          option.description.includes(`\`${option.requiresCli}\``),
          `${question.role}/${option.value} description must name the required CLI`,
        );
      }
    }
  }
});

test("codex as frontendReviewer carries the note about overriding the AGY review policy", () => {
  const question = PROJECT_CONFIG_QUESTIONS.frontendReviewer;
  const codexOption = question.options.find((option) => option.value === "codex");

  assert.ok(codexOption.note, "codex option must carry an override note");
  assert.match(codexOption.note, /AGY/);
  assert.match(codexOption.note, /workflow-log\.md/);
  assert.ok(codexOption.description.includes(codexOption.note));

  const agyOption = question.options.find((option) => option.value === "agy");
  assert.equal(agyOption.note, null, "default AGY option overrides nothing");
});

// --- Erros do parser em exemplos concretos (Req 3.8, 3.9, 3.10) ------------

test("parser error names the missing required field and the file path", () => {
  const error = captureError(() =>
    parseProjectConfig(fileWithout("frontendExecutor"), { path: "proj/.orchestrator/project-config.md" }),
  );

  assert.ok(error instanceof ProjectConfigError);
  assert.equal(error.code, "PROJECT_CONFIG_FIELD_MISSING");
  assert.equal(error.details.field, "frontendExecutor");
  assert.equal(error.details.path, "proj/.orchestrator/project-config.md");
  assert.match(error.message, /frontendExecutor/);
  assert.match(error.message, /proj\/\.orchestrator\/project-config\.md/);
});

test("parser error names field, received value and accepted set for an invalid executor", () => {
  const error = captureError(() =>
    parseProjectConfig(fileWith("backendReviewer", "gemini"), { path: "proj/config.md" }),
  );

  assert.ok(error instanceof ProjectConfigError);
  assert.equal(error.code, "PROJECT_CONFIG_INVALID_VALUE");
  assert.equal(error.details.field, "backendReviewer");
  assert.equal(error.details.received, "gemini");
  assert.deepEqual(error.details.accepted, [...EXECUTORS]);
  assert.match(error.message, /backendReviewer/);
  assert.match(error.message, /gemini/);
  for (const executor of EXECUTORS) assert.ok(error.message.includes(executor));
});

test("parser rejects content without any recognizable field line and unsupported schema versions", () => {
  const unparseable = captureError(() =>
    parseProjectConfig("# ORCHESTRATOR PROJECT CONFIG\n\nnada aqui\n", { path: "proj/config.md" }),
  );
  assert.ok(unparseable instanceof ProjectConfigError);
  assert.equal(unparseable.code, "PROJECT_CONFIG_UNPARSEABLE");
  assert.equal(unparseable.details.path, "proj/config.md");

  const unsupported = captureError(() =>
    parseProjectConfig(fileWith("schemaVersion", String(PROJECT_CONFIG_SCHEMA_VERSION + 1))),
  );
  assert.ok(unsupported instanceof ProjectConfigError);
  assert.equal(unsupported.code, "PROJECT_CONFIG_SCHEMA_UNSUPPORTED");
  assert.equal(unsupported.details.received, PROJECT_CONFIG_SCHEMA_VERSION + 1);
});

test("reading an invalid file throws and leaves the file byte-for-byte unchanged", () => {
  const root = projectRoot();
  const path = projectConfigPath(root);
  const broken = fileWith("frontendReviewer", "gemini");
  writeProjectConfig(root, VALID_CONFIG, { now: "2026-02-14T18:05:31Z" });
  writeFileSync(path, broken, "utf8");

  const error = captureError(() => readProjectConfig(root));
  assert.ok(error instanceof ProjectConfigError);
  assert.equal(error.code, "PROJECT_CONFIG_INVALID_VALUE");
  assert.equal(error.details.path, path);
  assert.equal(readFileSync(path, "utf8"), broken);
});

// --- Diff vazio: nenhum papel mudou (Req 6.7) -----------------------------

test("diffProjectConfig returns an empty list when no role changed", () => {
  const previous = parseProjectConfig(VALID_FILE);
  const next = parseProjectConfig(renderProjectConfig(previous, { now: "2026-03-01T09:00:00Z" }));

  assert.notEqual(previous.updatedAt, next.updatedAt);
  assert.deepEqual(diffProjectConfig(previous, next), []);
  assert.deepEqual(diffProjectConfig(VALID_CONFIG, { ...VALID_CONFIG }), []);
});

test("diffProjectConfig lists only the roles that changed, in canonical order", () => {
  const differences = diffProjectConfig(VALID_CONFIG, {
    ...VALID_CONFIG,
    frontendExecutor: "claude-code",
    backendReviewer: "claude-code",
  });

  assert.deepEqual(differences, [
    { role: "frontendExecutor", from: "agy", to: "claude-code" },
    { role: "backendReviewer", from: "codex", to: "claude-code" },
  ]);
});
