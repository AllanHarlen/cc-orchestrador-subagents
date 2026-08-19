import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import fc from "fast-check";

import {
  DEFAULT_PROJECT_CONFIG,
  EXECUTOR_REQUIRED_CLI,
  EXECUTORS,
  PROJECT_CONFIG_DEFAULT_APPLIED_MARK,
  PROJECT_CONFIG_FIELDS,
  PROJECT_CONFIG_QUESTIONS,
  PROJECT_CONFIG_RELATIVE_PATH,
  ProjectConfigError,
  ROLES,
  applyProjectConfigDefaults,
  deriveRequiredCliSet,
  parseProjectConfig,
  projectConfigPath,
  readProjectConfig,
  renderProjectConfig,
  writeProjectConfig,
} from "../skills/orchestrator-multi-agent-development/scripts/lib/project-config.mjs";
import {
  PROJECT_CONFIG_DEFECT_CODES,
  PROJECT_CONFIG_ROUND_TRIP_FIELDS,
  arbConfigFileNoise,
  arbDefectiveProjectConfigFile,
  arbEquivalentInstants,
  arbInstantAdvanceSeconds,
  arbPartialProjectConfigAnswers,
  arbProjectConfig,
  arbProjectConfigWithExtras,
  arbRoles,
  pickRoundTripFields,
} from "./helpers/project-config-arbitraries.mjs";

/**
 * Testes de propriedade do modulo de configuracao de projeto.
 *
 * Uma propriedade do design por teste, cada uma com o comentario de tag e o
 * minimo de 100 iteracoes. Novas propriedades desta area sao adicionadas neste
 * arquivo, na ordem do design.
 */

const NUM_RUNS = 200;

// Feature: orchestrator-mcp-agent-config, Property 1: Round-trip do serializador de configuracao
// Para qualquer Project_Config valida, ler o resultado do Config_Renderer para essa configuracao
// produz uma Project_Config igual a original nos seis campos.
//
// **Validates: Requirements 3.5, 3.6**
test("Property 1: round-trip do serializador preserva os seis campos", () => {
  fc.assert(
    fc.property(arbProjectConfig(), (config) => {
      const content = renderProjectConfig(config);
      const parsed = parseProjectConfig(content, { path: PROJECT_CONFIG_RELATIVE_PATH });

      for (const field of PROJECT_CONFIG_ROUND_TRIP_FIELDS) {
        assert.notEqual(
          parsed[field],
          undefined,
          `campo ${field} deveria estar preenchido apos o parse`,
        );
      }
      assert.deepEqual(pickRoundTripFields(parsed), pickRoundTripFields(config));
    }),
    { numRuns: NUM_RUNS },
  );
});

// Feature: orchestrator-mcp-agent-config, Property 2: Round-trip de arquivo normalizado
// Para qualquer Project_Config_File valido, inclusive com espacamento variavel, ordem arbitraria
// das linhas de campo, BOM UTF-8 ou terminadores CRLF, serializar o resultado do Config_Parser
// produz conteudo cujo reparse devolve a mesma Project_Config.
//
// **Validates: Requirements 3.7, 2.9**
test("Property 2: arquivo ruidoso normaliza para conteudo cujo reparse e estavel", (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "project-config-noise-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  const target = projectConfigPath(workspace);
  mkdirSync(dirname(target), { recursive: true });

  fc.assert(
    fc.property(arbConfigFileNoise(), ({ content, config }) => {
      const parsed = parseProjectConfig(content, { path: PROJECT_CONFIG_RELATIVE_PATH });
      assert.deepEqual(parsed, config);

      // Serializar o resultado do parser e reler produz a mesma Project_Config...
      const normalized = renderProjectConfig(parsed, { path: PROJECT_CONFIG_RELATIVE_PATH });
      const reparsed = parseProjectConfig(normalized, { path: PROJECT_CONFIG_RELATIVE_PATH });
      assert.deepEqual(reparsed, parsed);
      // ...e o conteudo canonico e ponto fixo do renderer.
      assert.equal(renderProjectConfig(reparsed, { path: PROJECT_CONFIG_RELATIVE_PATH }), normalized);

      // Arquivo presente e valido: o carregamento devolve a configuracao do arquivo,
      // com origem `file`, sem depender da forma ruidosa do conteudo (Req 2.9).
      writeFileSync(target, content, "utf8");
      const loaded = readProjectConfig(workspace);
      assert.equal(loaded.exists, true);
      assert.equal(loaded.source, "file");
      assert.deepEqual(loaded.config, parsed);
    }),
    { numRuns: NUM_RUNS },
  );
});

/* -------------------------------------------------------------------------- */
/* Gramatica canonica do Project_Config_File                                   */
/* -------------------------------------------------------------------------- */

/** Linha de campo canonica: marcador `- `, nome em negrito, `: ` e valor. */
const CANONICAL_FIELD_LINE = /^- \*\*([A-Za-z][A-Za-z0-9]*)\*\*: (.+)$/;
/** Linha da secao `## Notas`: papel, `: ` e a marca de default aplicado. */
const CANONICAL_NOTE_LINE = new RegExp(
  `^- ([A-Za-z][A-Za-z0-9]*): ${PROJECT_CONFIG_DEFAULT_APPLIED_MARK}$`,
);
const CANONICAL_HEADING_LINE = /^#{1,2} \S.*$/;
const CANONICAL_LEAD_LINE = /^> \S.*$/;
const CANONICAL_UPDATED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// Feature: orchestrator-mcp-agent-config, Property 3: Gramatica canonica e ausencia de conteudo extra no arquivo
// Para qualquer Project_Config, inclusive quando o objeto de entrada carrega campos extras
// arbitrarios, o conteudo gravado contem os seis campos exatamente uma vez cada, na ordem
// canonica, em linha de lista com o nome do campo em negrito, com valores de executor e reviewer
// em minusculas restritos a `codex`/`agy`/`claude-code`, e nenhuma linha fora dessa gramatica.
//
// **Validates: Requirements 3.2, 3.4, 3.11**
test("Property 3: conteudo gravado respeita a gramatica canonica e nao carrega campo extra", () => {
  fc.assert(
    fc.property(arbProjectConfigWithExtras(), ({ input, config, extras }) => {
      const content = renderProjectConfig(input);

      // Terminador unico e uma linha final: o conteudo e um documento de linhas LF.
      assert.equal(content.endsWith("\n"), true, "conteudo deveria terminar em nova linha");
      assert.equal(content.includes("\r"), false, "conteudo nao deveria conter CR");
      const lines = content.slice(0, -1).split("\n");

      // Toda linha pertence a gramatica: vazia, titulo/secao, linha de contexto,
      // linha de campo em negrito ou linha de nota de default aplicado.
      const fieldOrder = [];
      const fieldValues = new Map();
      const noteRoles = [];
      lines.forEach((line, index) => {
        if (line === "") return;
        const fieldMatch = line.match(CANONICAL_FIELD_LINE);
        if (fieldMatch) {
          const [, name, value] = fieldMatch;
          assert.ok(
            PROJECT_CONFIG_FIELDS.includes(name),
            `linha ${index} declara o campo desconhecido ${JSON.stringify(name)}`,
          );
          assert.equal(fieldValues.has(name), false, `campo ${name} aparece mais de uma vez`);
          fieldOrder.push(name);
          fieldValues.set(name, value);
          return;
        }
        const noteMatch = line.match(CANONICAL_NOTE_LINE);
        if (noteMatch) {
          assert.ok(ROLES.includes(noteMatch[1]), `nota ${index} cita papel desconhecido`);
          noteRoles.push(noteMatch[1]);
          return;
        }
        assert.ok(
          CANONICAL_HEADING_LINE.test(line) || CANONICAL_LEAD_LINE.test(line),
          `linha ${index} esta fora da gramatica canonica: ${JSON.stringify(line)}`,
        );
      });

      // Os seis campos, exatamente uma vez cada, na ordem canonica e contiguos.
      assert.deepEqual(fieldOrder, [...PROJECT_CONFIG_FIELDS]);
      const firstField = lines.findIndex((line) => CANONICAL_FIELD_LINE.test(line));
      const fieldBlock = lines.slice(firstField, firstField + PROJECT_CONFIG_FIELDS.length);
      assert.equal(
        fieldBlock.every((line) => CANONICAL_FIELD_LINE.test(line)),
        true,
        "as seis linhas de campo deveriam ser contiguas",
      );
      for (const field of PROJECT_CONFIG_FIELDS) {
        const occurrences = content.split(`**${field}**`).length - 1;
        assert.equal(occurrences, 1, `campo ${field} deveria aparecer exatamente uma vez`);
      }

      // Valores: papeis em minusculas dentro do conjunto permitido; metadados canonicos.
      for (const role of ROLES) {
        const value = fieldValues.get(role);
        assert.equal(value, value.toLowerCase(), `valor de ${role} deveria estar em minusculas`);
        assert.ok(EXECUTORS.includes(value), `valor de ${role} fora do conjunto permitido: ${value}`);
        assert.equal(value, config[role]);
      }
      assert.equal(fieldValues.get("schemaVersion"), String(config.schemaVersion));
      assert.match(fieldValues.get("updatedAt"), CANONICAL_UPDATED_AT);

      // A secao `## Notas` cobre exatamente os papeis com default aplicado.
      assert.deepEqual(noteRoles, config.defaultsApplied ?? []);

      // Campo extra nao chega ao arquivo: nem a chave, nem o valor.
      for (const [key, value] of Object.entries(extras)) {
        assert.equal(content.includes(key), false, `chave extra ${key} vazou para o arquivo`);
        assert.equal(
          content.toLowerCase().includes(value.toLowerCase()),
          false,
          `valor extra de ${key} vazou para o arquivo`,
        );
      }

      // O reparse do conteudo confirma a semantica: nenhuma chave extra sobrevive.
      const parsed = parseProjectConfig(content, { path: PROJECT_CONFIG_RELATIVE_PATH });
      assert.deepEqual(Object.keys(parsed).sort(), [...PROJECT_CONFIG_FIELDS, "defaultsApplied"].sort());
    }),
    { numRuns: NUM_RUNS },
  );
});
/* -------------------------------------------------------------------------- */
/* Timestamp e idempotencia do renderer                                        */
/* -------------------------------------------------------------------------- */

/** Linha canonica do campo `updatedAt` no conteudo gravado. */
const UPDATED_AT_LINE = /^- \*\*updatedAt\*\*: (.+)$/;

/** Valor de `updatedAt` do conteudo, exigindo exatamente uma ocorrencia. */
function updatedAtValue(content) {
  const matches = content.split("\n").filter((line) => UPDATED_AT_LINE.test(line));
  assert.equal(matches.length, 1, "conteudo deveria ter exatamente uma linha de updatedAt");
  return matches[0].match(UPDATED_AT_LINE)[1];
}

/** Conteudo sem a linha de `updatedAt`: a parte que a idempotencia exige estavel. */
function linesWithoutUpdatedAt(content) {
  return content.split("\n").filter((line) => !UPDATED_AT_LINE.test(line));
}

// Feature: orchestrator-mcp-agent-config, Property 4: Formato do timestamp e idempotencia do renderer
// Para qualquer Project_Config e qualquer instante, `updatedAt` e serializado como UTC ISO 8601 com
// precisao de segundos, e duas serializacoes da mesma configuracao produzem conteudo identico —
// byte a byte quando o instante e o mesmo, e identico em todas as linhas exceto `updatedAt` quando
// o instante avanca.
//
// **Validates: Requirements 3.3, 3.12, 6.4**
test("Property 4: updatedAt e UTC com precisao de segundos e o renderer e idempotente", (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "project-config-instant-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  fc.assert(
    fc.property(
      arbProjectConfig({ defaultsApplied: true }),
      arbEquivalentInstants(),
      arbInstantAdvanceSeconds(),
      (config, instant, advanceSeconds) => {
        const baseline = renderProjectConfig(config, { now: instant.canonical });

        // Formato do timestamp: UTC ISO 8601 com precisao de segundos, sem fracao
        // e sem deslocamento de fuso (Req 3.3).
        const rendered = updatedAtValue(baseline);
        assert.match(rendered, CANONICAL_UPDATED_AT);
        assert.equal(rendered, instant.canonical);
        assert.equal(rendered, `${new Date(rendered).toISOString().slice(0, 19)}Z`);
        assert.equal(Date.parse(rendered) % 1000, 0, "updatedAt nao deveria carregar fracao de segundo");

        // Idempotencia byte a byte: o mesmo instante, em qualquer representacao
        // equivalente, produz o mesmo conteudo (Req 3.12).
        for (const variant of instant.variants) {
          assert.equal(
            renderProjectConfig(config, { now: variant }),
            baseline,
            `representacao ${String(variant)} deveria produzir o conteudo canonico`,
          );
        }

        // Instante avanca: so `updatedAt` muda; todas as outras linhas ficam
        // identicas, inclusive a secao `## Notas` (Req 3.12).
        const advanced = new Date(Date.parse(instant.canonical) + advanceSeconds * 1000);
        const advancedCanonical = `${advanced.toISOString().slice(0, 19)}Z`;
        const reparsed = parseProjectConfig(baseline, { path: PROJECT_CONFIG_RELATIVE_PATH });
        const next = renderProjectConfig(reparsed, { now: advanced });

        assert.notEqual(next, baseline, "instante novo deveria mudar o conteudo");
        assert.equal(updatedAtValue(next), advancedCanonical);
        assert.notEqual(updatedAtValue(next), rendered);
        assert.deepEqual(linesWithoutUpdatedAt(next), linesWithoutUpdatedAt(baseline));

        // Regravar a mesma configuracao com instante novo atualiza `updatedAt` e
        // preserva o resto do arquivo byte a byte (Req 6.4).
        const first = writeProjectConfig(workspace, config, { now: instant.canonical });
        assert.equal(readFileSync(first.path, "utf8"), baseline);
        const second = writeProjectConfig(workspace, config, { now: advanced });
        const persisted = readFileSync(second.path, "utf8");

        assert.equal(persisted, second.content);
        assert.equal(updatedAtValue(persisted), advancedCanonical);
        assert.deepEqual(linesWithoutUpdatedAt(persisted), linesWithoutUpdatedAt(baseline));
        assert.deepEqual(
          pickRoundTripFields(second.config),
          pickRoundTripFields({ ...config, updatedAt: advancedCanonical }),
        );
      },
    ),
    { numRuns: NUM_RUNS },
  );
});

/* -------------------------------------------------------------------------- */
/* Erro do parser e preservacao do arquivo defeituoso                          */
/* -------------------------------------------------------------------------- */

const PREFLIGHT_SCRIPT = fileURLToPath(
  new URL("../skills/orchestrator-multi-agent-development/scripts/preflight.mjs", import.meta.url),
);

/** Executa `run`, exigindo `ProjectConfigError`, e devolve o erro capturado. */
function captureProjectConfigError(run, label) {
  try {
    run();
  } catch (error) {
    assert.ok(
      error instanceof ProjectConfigError,
      `${label} deveria lancar ProjectConfigError, veio: ${error?.name}: ${error?.message}`,
    );
    return error;
  }
  return assert.fail(`${label} deveria ter lancado ProjectConfigError`);
}

/**
 * O erro nomeia o defeito: codigo esperado, campo, caminho do arquivo e — para
 * valor invalido ou schema nao suportado — o valor recebido e o conjunto aceito,
 * todos citados na mensagem.
 */
function assertErrorNamesDefect(error, defect, path) {
  assert.equal(error.code, defect.code, `codigo do defeito ${defect.kind}`);
  assert.equal(error.details.path, path, "details.path deveria nomear o arquivo lido");
  assert.ok(error.message.includes(path), `mensagem deveria nomear o caminho: ${error.message}`);

  if (defect.field !== null) {
    assert.equal(error.details.field, defect.field, "details.field deveria nomear o campo");
    assert.ok(
      error.message.includes(defect.field),
      `mensagem deveria nomear o campo ${defect.field}: ${error.message}`,
    );
  }

  if (defect.code === "PROJECT_CONFIG_UNPARSEABLE") {
    assert.equal(typeof error.details.reason, "string");
    assert.ok(error.details.reason.length > 0, "details.reason deveria explicar o defeito");
    assert.ok(error.message.includes(error.details.reason));
    return;
  }

  if (defect.code === "PROJECT_CONFIG_FIELD_MISSING") {
    // Campo ausente nao tem valor recebido nem conjunto aceito para nomear.
    assert.match(error.message, /missing/i);
    return;
  }

  // Valor invalido e schema nao suportado nomeiam o valor recebido...
  if (defect.received !== null) assert.equal(error.details.received, defect.received);
  assert.ok(
    error.message.includes(String(error.details.received)),
    `mensagem deveria nomear o valor recebido: ${error.message}`,
  );

  // ...e o conjunto de valores aceitos.
  const accepted = error.details.accepted;
  assert.ok(Array.isArray(accepted) && accepted.length > 0, "details.accepted deveria ser lista nao vazia");
  if (defect.accepted !== null) assert.deepEqual(accepted, defect.accepted);
  for (const value of accepted) {
    assert.ok(
      error.message.includes(String(value)),
      `mensagem deveria nomear o valor aceito ${value}: ${error.message}`,
    );
  }
}

/** Um exemplo defeituoso por codigo de erro, para exercitar o preflight. */
function defectSamplesByCode() {
  const byCode = new Map();
  for (const sample of fc.sample(arbDefectiveProjectConfigFile(), 80)) {
    if (!byCode.has(sample.defect.code)) byCode.set(sample.defect.code, sample);
    if (byCode.size === PROJECT_CONFIG_DEFECT_CODES.length) break;
  }
  return [...byCode.values()];
}

// Feature: orchestrator-mcp-agent-config, Property 5: Erro do parser nomeia o defeito e preserva o arquivo
// Para qualquer Project_Config_File defeituoso — campo obrigatorio ausente ou valor de
// executor/reviewer fora do conjunto permitido — o Config_Parser retorna erro que nomeia o campo, o
// caminho do arquivo e, no caso de valor invalido, o valor recebido e o conjunto aceito; e o
// conteudo do arquivo permanece byte a byte inalterado apos a tentativa de leitura e apos o
// preflight marcar o item como reprovado.
//
// **Validates: Requirements 3.8, 3.9, 3.10**
test("Property 5: erro do parser nomeia o defeito e a leitura preserva o arquivo", (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "project-config-defect-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  const target = projectConfigPath(workspace);
  mkdirSync(dirname(target), { recursive: true });

  const codesSeen = new Set();

  fc.assert(
    fc.property(arbDefectiveProjectConfigFile(), ({ content, defect }) => {
      codesSeen.add(defect.code);

      // O parser nomeia o defeito ja na leitura em memoria (Req 3.8, 3.9).
      const parseError = captureProjectConfigError(
        () => parseProjectConfig(content, { path: PROJECT_CONFIG_RELATIVE_PATH }),
        `parseProjectConfig (${defect.kind})`,
      );
      assertErrorNamesDefect(parseError, defect, PROJECT_CONFIG_RELATIVE_PATH);

      // Arquivo real: o carregamento propaga o mesmo erro, agora com o caminho
      // absoluto do arquivo, e nunca inventa configuracao a partir dele.
      writeFileSync(target, content, "utf8");
      const before = readFileSync(target);

      const readError = captureProjectConfigError(
        () => readProjectConfig(workspace),
        `readProjectConfig (${defect.kind})`,
      );
      assertErrorNamesDefect(readError, defect, target);
      assert.equal(readError.code, parseError.code);

      // Ler arquivo defeituoso nao toca o filesystem: bytes intactos (Req 3.10).
      assert.deepEqual(readFileSync(target), before, "leitura nao deveria alterar o arquivo");
    }),
    { numRuns: NUM_RUNS },
  );

  // O espaco gerado cobre os quatro codigos do Config_Parser.
  assert.deepEqual([...codesSeen].sort(), [...PROJECT_CONFIG_DEFECT_CODES].sort());

  // Preflight: arquivo defeituoso reprova o check obrigatorio, bloqueia com
  // remediacao de corrigir ou remover, e preserva o conteudo (Req 3.10).
  for (const { content, defect } of defectSamplesByCode()) {
    writeFileSync(target, content, "utf8");
    const before = readFileSync(target);

    const run = spawnSync(process.execPath, [PREFLIGHT_SCRIPT], {
      cwd: workspace,
      encoding: "utf8",
    });
    assert.equal(run.status, 1, `preflight deveria falhar para o defeito ${defect.kind}`);

    const report = JSON.parse(run.stdout);
    assert.equal(report.status, "failed");

    const check = report.checks.config["project-config"];
    assert.equal(check.ok, false);
    assert.equal(check.required, true);
    assert.equal(check.exists, true);
    assert.equal(check.source, "invalid");
    assert.equal(check.code, defect.code);
    assert.equal(resolve(check.path).toLowerCase(), resolve(target).toLowerCase());
    if (defect.field !== null) assert.equal(check.field, defect.field);
    if (defect.received !== null) assert.equal(check.received, defect.received);

    const failure = report.failed.find(
      (entry) => entry.category === "config" && entry.name === "project-config",
    );
    assert.ok(failure, "item reprovado e obrigatorio deveria entrar em failed");

    const remediation = report.remediation.find((entry) =>
      entry.target.includes(PROJECT_CONFIG_RELATIVE_PATH),
    );
    assert.ok(remediation, "remediacao do arquivo de configuracao deveria estar no relatorio");
    assert.ok(
      remediation.steps.some((step) => step.includes(`Corrija ${PROJECT_CONFIG_RELATIVE_PATH}`)),
      "remediacao deveria oferecer corrigir o arquivo",
    );
    assert.ok(
      remediation.steps.some((step) => step.includes(`Ou remova ${PROJECT_CONFIG_RELATIVE_PATH}`)),
      "remediacao deveria oferecer remover o arquivo",
    );

    // O preflight reprova o item sem reescrever o arquivo do usuario.
    assert.deepEqual(readFileSync(target), before, "preflight nao deveria alterar o arquivo");
  }
});

/* -------------------------------------------------------------------------- */
/* Defaults aplicados na coleta                                                */
/* -------------------------------------------------------------------------- */

/** Cabecalho da secao que carrega as marcas de default aplicado. */
const NOTES_HEADING = "## Notas";

/** Ocorrencias de `needle` em `haystack`. */
function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// Feature: orchestrator-mcp-agent-config, Property 14: Defaults aplicados sao registrados e sobrevivem ao round-trip
// Para qualquer subconjunto dos quatro papeis deixado sem resposta na coleta, a Project_Config
// resultante tem o valor padrao nesses papeis, `defaultsApplied` igual exatamente a esse
// subconjunto, e a marca `default-aplicado` sobrevive ao round-trip de gravacao e leitura.
//
// **Validates: Requirements 2.8**
test("Property 14: papel sem resposta recebe o default e a marca sobrevive ao round-trip", (t) => {
  const workspace = mkdtempSync(join(tmpdir(), "project-config-defaults-"));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));

  fc.assert(
    fc.property(
      arbPartialProjectConfigAnswers(),
      ({ answers, unanswered, expectedRoles, updatedAt }) => {
        const resolved = applyProjectConfigDefaults(answers, { now: updatedAt });

        // Papel sem resposta recebe o valor padrao; papel respondido preserva a
        // resposta normalizada (Req 2.8).
        for (const role of ROLES) {
          assert.equal(resolved[role], expectedRoles[role], `valor resolvido de ${role}`);
          if (unanswered.includes(role)) {
            assert.equal(resolved[role], DEFAULT_PROJECT_CONFIG[role], `default de ${role}`);
          }
        }

        // `defaultsApplied` e exatamente o subconjunto sem resposta, em ordem canonica.
        assert.deepEqual(resolved.defaultsApplied, unanswered);
        assert.equal(resolved.updatedAt, updatedAt);

        // A marca entra no conteudo gravado: uma linha por papel com default
        // aplicado, sob `## Notas`, e nenhuma marca quando o subconjunto e vazio.
        const content = renderProjectConfig(resolved);
        assert.equal(
          countOccurrences(content, PROJECT_CONFIG_DEFAULT_APPLIED_MARK),
          unanswered.length,
          "marca deveria aparecer uma vez por papel com default aplicado",
        );
        assert.equal(content.includes(NOTES_HEADING), unanswered.length > 0);
        for (const role of unanswered) {
          assert.equal(
            countOccurrences(content, `- ${role}: ${PROJECT_CONFIG_DEFAULT_APPLIED_MARK}\n`),
            1,
            `nota de ${role} deveria aparecer exatamente uma vez`,
          );
        }
        for (const role of ROLES) {
          if (unanswered.includes(role)) continue;
          assert.equal(
            content.includes(`- ${role}: ${PROJECT_CONFIG_DEFAULT_APPLIED_MARK}`),
            false,
            `papel respondido ${role} nao deveria ter nota de default`,
          );
        }

        // Round-trip em memoria: a marca e os seis campos voltam iguais.
        const parsed = parseProjectConfig(content, { path: PROJECT_CONFIG_RELATIVE_PATH });
        assert.deepEqual(parsed.defaultsApplied, unanswered);
        assert.deepEqual(pickRoundTripFields(parsed), pickRoundTripFields(resolved));
        assert.deepEqual(parsed, resolved);

        // Round-trip no filesystem: gravar e reler preserva a marca (Req 2.8).
        const written = writeProjectConfig(workspace, resolved);
        assert.equal(readFileSync(written.path, "utf8"), content);
        assert.deepEqual(written.config, resolved);

        const loaded = readProjectConfig(workspace);
        assert.equal(loaded.exists, true);
        assert.equal(loaded.source, "file");
        assert.deepEqual(loaded.config.defaultsApplied, unanswered);
        assert.deepEqual(loaded.config, resolved);
      },
    ),
    { numRuns: NUM_RUNS },
  );
});

// Feature: orchestrator-mcp-agent-config, Property 15: Opcao de pergunta anuncia a CLI que ela exige
// Para qualquer papel e qualquer opcao oferecida nesse papel, a CLI anunciada na descricao da opcao e
// exatamente a CLI que uma Project_Config com aquele valor nesse papel tornaria obrigatoria.
//
// **Validates: Requirements 2.6**
test("Property 15: requiresCli da opcao e a CLI que a escolha torna obrigatoria", () => {
  fc.assert(
    fc.property(arbRoles(), (otherRoles) => {
      for (const role of ROLES) {
        for (const option of PROJECT_CONFIG_QUESTIONS[role].options) {
          // A tabela publicada e a tabela derivada concordam sobre a CLI da opcao,
          // sem depender de tabela paralela.
          assert.equal(option.requiresCli, EXECUTOR_REQUIRED_CLI[option.value]);

          // Construir uma Project_Config com esse papel na opcao e os demais
          // papeis arbitrarios: a CLI anunciada e obrigatoria se e somente se a
          // opcao a exige, independente do que os outros papeis escolhem.
          const config = { ...otherRoles, [role]: option.value };
          const required = deriveRequiredCliSet(config);

          if (option.requiresCli === null) {
            assert.ok(
              !required.clis.includes(EXECUTOR_REQUIRED_CLI[option.value] ?? "__none__"),
              `${role}=${option.value} nao deveria exigir CLI`,
            );
          } else {
            assert.ok(
              required.clis.includes(option.requiresCli),
              `${role}=${option.value} deveria tornar ${option.requiresCli} obrigatoria`,
            );
            assert.ok(required.rolesByCli[option.requiresCli].includes(role));
          }
        }
      }
    }),
    { numRuns: NUM_RUNS },
  );
});
