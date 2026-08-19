import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import test from "node:test";

import fc from "fast-check";

import {
  CODEBASE_MEMORY_MCP,
  CODEBASE_MEMORY_MCP_BINARY,
  CONTEXT7_MCP,
  MCP_DETECT_TIMEOUT_MS,
  MCP_EVIDENCE_TYPES,
  MCP_EVIDENCE_UNREADABLE,
  MCP_SERVER_NAMES,
  detectMcpServers,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/mcp-detect.mjs";

/**
 * Teste de propriedade da deteccao dos MCPs opcionais.
 *
 * Uma unica propriedade do design (Property 6), exercitada por fixture de
 * filesystem em diretorio temporario, com `home`, `projectRoot`, `now`, `env`,
 * `platform` e `pathLookup` injetados. Nenhuma I/O de rede, nenhum processo
 * externo, nenhuma dependencia do ambiente real da maquina.
 */

const NUM_RUNS = 120;

/* -------------------------------------------------------------------------- */
/* Universo de candidatos inspecionados pela deteccao                          */
/* -------------------------------------------------------------------------- */

const BOTH = MCP_SERVER_NAMES;

/**
 * Localizacoes de configuracao MCP conhecidas, com o conjunto de servidores que
 * inspeciona cada uma. As cinco primeiras cobrem o Req 1.3 do CBM_MCP.
 */
const CONFIG_SLOTS = Object.freeze([
  { id: "project-mcp", base: "project", rel: [".mcp.json"], servers: BOTH },
  { id: "claude-json", base: "home", rel: [".claude.json"], servers: BOTH },
  { id: "claude-mcp", base: "home", rel: [".claude", "mcp.json"], servers: BOTH },
  { id: "codex-toml", base: "home", rel: [".codex", "config.toml"], servers: BOTH },
  {
    id: "gemini-mcp-config",
    base: "home",
    rel: [".gemini", "config", "mcp_config.json"],
    servers: BOTH,
  },
  {
    id: "config-claude-mcp",
    base: "home",
    rel: [".config", "claude", "mcp.json"],
    servers: [CONTEXT7_MCP],
  },
  { id: "gemini-settings", base: "home", rel: [".gemini", "settings.json"], servers: [CONTEXT7_MCP] },
  { id: "gemini-mcp", base: "home", rel: [".gemini", "mcp.json"], servers: [CONTEXT7_MCP] },
  {
    id: "antigravity-settings",
    base: "home",
    rel: [".gemini", "antigravity-cli", "settings.json"],
    servers: [CONTEXT7_MCP],
  },
]);

/** Skills instaladas, evidencia de tipo `skill`. */
const SKILL_SLOTS = Object.freeze([
  {
    id: "skill-cbm",
    base: "home",
    rel: [".claude", "skills", "codebase-memory", "SKILL.md"],
    server: CODEBASE_MEMORY_MCP,
  },
  {
    id: "skill-ctx7",
    base: "home",
    rel: [".claude", "skills", "context7", "SKILL.md"],
    server: CONTEXT7_MCP,
  },
]);

/** Diretorios de servidor MCP, evidencia de tipo `mcp-directory`. */
const DIRECTORY_SLOTS = Object.freeze([
  {
    id: "antigravity-mcp-context7",
    base: "home",
    rel: [".gemini", "antigravity-cli", "mcp", "context7"],
    server: CONTEXT7_MCP,
  },
]);

const BINARY_BY_SERVER = Object.freeze({
  [CODEBASE_MEMORY_MCP]: CODEBASE_MEMORY_MCP_BINARY,
  [CONTEXT7_MCP]: "ctx7",
});

/**
 * Estados possiveis de uma localizacao de configuracao:
 * ausente, presente sem marcador, presente com marcador de um ou dos dois
 * servidores, ou presente e ilegivel.
 */
const CONFIG_STATES = Object.freeze([
  "absent",
  "no-marker",
  "codebase-memory",
  "context7",
  "both",
  "unreadable",
]);

/** Servidores cujo marcador o estado semeia no conteudo do arquivo. */
function markedServers(state) {
  if (state === "both") return [...BOTH];
  if (state === CODEBASE_MEMORY_MCP) return [CODEBASE_MEMORY_MCP];
  if (state === CONTEXT7_MCP) return [CONTEXT7_MCP];
  return [];
}

/** Nomes de servidor gravados no conteudo, por estado. */
function serverNamesFor(state) {
  const names = [];
  if (state === CODEBASE_MEMORY_MCP || state === "both") names.push("codebase-memory-mcp");
  if (state === CONTEXT7_MCP || state === "both") names.push("context7");
  if (names.length === 0) names.push("filesystem");
  return names;
}

function isToml(slot) {
  return slot.rel[slot.rel.length - 1].endsWith(".toml");
}

function configContent(slot, state) {
  const names = serverNamesFor(state);
  if (isToml(slot)) {
    return `${names.map((name) => `[mcp_servers."${name}"]\ncommand = "npx"`).join("\n\n")}\n`;
  }
  const servers = Object.fromEntries(
    names.map((name) => [name, { command: "npx", args: ["-y", name] }]),
  );
  return `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`;
}

/* -------------------------------------------------------------------------- */
/* Gerador de fixture                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Gera uma combinacao de localizacoes semeadas com marcador, ausentes ou
 * ilegiveis, mais a presenca de skill, diretorio de servidor e binario no
 * `PATH` por servidor.
 */
function arbMcpFixture() {
  return fc.record({
    configs: fc.tuple(...CONFIG_SLOTS.map(() => fc.constantFrom(...CONFIG_STATES))),
    skills: fc.tuple(...SKILL_SLOTS.map(() => fc.boolean())),
    directories: fc.tuple(...DIRECTORY_SLOTS.map(() => fc.boolean())),
    binaries: fc.tuple(...MCP_SERVER_NAMES.map(() => fc.boolean())),
    platform: fc.constantFrom("win32", "linux", "darwin"),
  });
}

/** Materializa a fixture no disco e devolve o plano do que foi semeado. */
function materialize(root, fixture) {
  const projectRoot = join(root, "project");
  const home = join(root, "home");
  const binDir = join(root, "bin");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(home, { recursive: true });

  const basePath = (base) => (base === "project" ? projectRoot : home);
  const slotPath = (slot) => join(basePath(slot.base), ...slot.rel);

  const configs = CONFIG_SLOTS.map((slot, index) => {
    const state = fixture.configs[index];
    const path = slotPath(slot);
    if (state !== "absent") {
      mkdirSync(dirname(path), { recursive: true });
      if (state === "unreadable") {
        // JSON invalido em candidato `.json`; diretorio no lugar do arquivo nos
        // demais. Ambos existem e falham na leitura ou no parse.
        if (isToml(slot)) mkdirSync(path, { recursive: true });
        else writeFileSync(path, '{ "mcpServers": ', "utf8");
      } else {
        writeFileSync(path, configContent(slot, state), "utf8");
      }
    }
    return { ...slot, state, path };
  });

  const skills = SKILL_SLOTS.map((slot, index) => {
    const present = fixture.skills[index];
    const path = slotPath(slot);
    if (present) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `# ${slot.server}\n`, "utf8");
    }
    return { ...slot, present, path };
  });

  const directories = DIRECTORY_SLOTS.map((slot, index) => {
    const present = fixture.directories[index];
    const path = slotPath(slot);
    if (present) mkdirSync(path, { recursive: true });
    return { ...slot, present, path };
  });

  const binaries = new Map();
  MCP_SERVER_NAMES.forEach((server, index) => {
    if (!fixture.binaries[index]) return;
    binaries.set(BINARY_BY_SERVER[server], join(binDir, BINARY_BY_SERVER[server]));
  });

  return { projectRoot, home, configs, skills, directories, binaries };
}

/** Evidencias que a fixture obriga a deteccao daquele servidor a registrar. */
function requiredEvidence(plan, server) {
  const required = [];
  for (const slot of plan.configs) {
    if (!slot.servers.includes(server)) continue;
    if (slot.state === "unreadable") {
      required.push({ type: MCP_EVIDENCE_UNREADABLE, path: slot.path });
    } else if (markedServers(slot.state).includes(server)) {
      required.push({ type: "mcp-config", path: slot.path });
    }
  }
  for (const slot of plan.skills) {
    if (slot.server === server && slot.present) required.push({ type: "skill", path: slot.path });
  }
  for (const slot of plan.directories) {
    if (slot.server === server && slot.present) {
      required.push({ type: "mcp-directory", path: slot.path });
    }
  }
  const binary = plan.binaries.get(BINARY_BY_SERVER[server]);
  if (binary !== undefined) required.push({ type: "binary", path: binary });
  return required;
}

function findEvidence(evidence, item) {
  return evidence.find((entry) => entry.type === item.type && entry.path === item.path);
}

// Feature: orchestrator-mcp-agent-config, Property 6: Deteccao de MCP e funcao das evidencias encontradas
// Para qualquer combinacao de localizacoes de configuracao semeadas com marcador do servidor,
// ausentes ou ilegiveis, o resultado da deteccao de cada MCP traz `ok`, `optional` e `evidence`;
// `ok` e verdadeiro se e somente se existe ao menos uma evidencia de tipo diferente de
// `mcp-config-unreadable`; toda localizacao semeada com marcador aparece em `evidence` com `type` e
// `path`; e uma localizacao ilegivel produz evidencia `mcp-config-unreadable` sem impedir a
// inspecao das localizacoes seguintes.
//
// **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.8**
test("Property 6: deteccao de MCP e funcao das evidencias encontradas", (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "mcp-detect-property-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  let iteration = 0;

  fc.assert(
    fc.property(arbMcpFixture(), (fixture) => {
      const root = join(workspace, `run-${iteration++}`);
      mkdirSync(root, { recursive: true });

      try {
        const plan = materialize(root, fixture);

        // Relogio constante e `env` vazio: nenhum deadline estoura e o `PATH` da
        // maquina real nao influencia. O `PATH` e simulado por `pathLookup`.
        const results = detectMcpServers({
          projectRoot: plan.projectRoot,
          home: plan.home,
          now: () => 1_000,
          timeoutMs: MCP_DETECT_TIMEOUT_MS,
          env: {},
          platform: fixture.platform,
          pathLookup: (name) => plan.binaries.get(name) ?? null,
        });

        // Req 1.1 e 1.2: os dois servidores aparecem no bloco, cada um com
        // `ok`, `optional` e `evidence`.
        assert.deepEqual(Object.keys(results), [...MCP_SERVER_NAMES]);

        for (const server of MCP_SERVER_NAMES) {
          const result = results[server];
          assert.equal(typeof result.ok, "boolean", `${server}: ok deveria ser booleano`);
          assert.equal(result.optional, true, `${server}: MCP e sempre opcional`);
          assert.ok(Array.isArray(result.evidence), `${server}: evidence deveria ser array`);

          // Toda evidencia tem `type` conhecido e `path` dentro da fixture:
          // nada do ambiente real da maquina entra no resultado.
          for (const entry of result.evidence) {
            assert.ok(
              MCP_EVIDENCE_TYPES.includes(entry.type),
              `${server}: tipo de evidencia desconhecido ${entry.type}`,
            );
            assert.equal(typeof entry.path, "string");
            assert.ok(
              entry.path.startsWith(root + sep),
              `${server}: evidencia fora da fixture: ${entry.path}`,
            );
          }

          const required = requiredEvidence(plan, server);

          // Req 1.4 e 1.8: cada localizacao semeada com marcador aparece com
          // `type` e `path`; cada localizacao ilegivel aparece como
          // `mcp-config-unreadable` com a mensagem de erro.
          for (const item of required) {
            const found = findEvidence(result.evidence, item);
            assert.ok(
              found !== undefined,
              `${server}: evidencia ausente ${item.type} ${item.path}`,
            );
            if (item.type === MCP_EVIDENCE_UNREADABLE) {
              assert.equal(typeof found.error, "string");
              assert.notEqual(found.error.trim(), "");
            }
          }

          // Nenhuma evidencia duplicada: par (type, path) e unico.
          const keys = result.evidence.map((entry) => `${entry.type}\u0000${entry.path}`);
          assert.equal(new Set(keys).size, keys.length, `${server}: evidencia duplicada`);

          // `ok` e verdadeiro se e somente se ha evidencia utilizavel.
          const usable = result.evidence.some((entry) => entry.type !== MCP_EVIDENCE_UNREADABLE);
          assert.equal(result.ok, usable, `${server}: ok deveria acompanhar a evidencia utilizavel`);

          // Localizacao ilegivel nao impede a inspecao das seguintes: com ao
          // menos uma evidencia utilizavel exigida pela fixture, `ok` e
          // verdadeiro mesmo havendo candidato ilegivel na varredura.
          const requiredUsable = required.filter((item) => item.type !== MCP_EVIDENCE_UNREADABLE);
          if (requiredUsable.length > 0) {
            assert.equal(result.ok, true, `${server}: ok deveria ser true com evidencia utilizavel`);
          }
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }),
    { numRuns: NUM_RUNS },
  );
});
