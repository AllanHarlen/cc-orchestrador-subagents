#!/usr/bin/env node

import {
  archiveRecipe,
  listLessons,
  listRecipes,
  matchRecipes,
  promoteLessonToRecipe,
  recordRecipeOutcome,
  runLearningPhase,
  setRecipePinned,
  validateLesson,
} from "./lib/learning-recipes.mjs";
import {
  activateRecipe,
  createKnowledgeBackup,
  curateKnowledge,
  curatorStatus,
  listKnowledgeBackups,
  rollbackKnowledge,
} from "./lib/knowledge-curator.mjs";
import {
  boolArg,
  executeJsonCli,
  jsonArg,
  numberArg,
  parseArgs,
  required,
} from "./lib/cli-utils.mjs";

function help() {
  return {
    name: "orchestration-learning",
    commands: {
      run: "run --dir .orchestration/<slug> [--root <project>]",
      "lesson-list": "lesson-list [--status CANDIDATE|VALIDATED|PROMOTED]",
      "lesson-validate": "lesson-validate --id <lesson> --evidence-type USER|TEST|CONTRACT|RUN_EVENT --source <ref> [--status PASS]",
      "recipe-promote": "recipe-promote --lesson <id> [--recipe-id <id>]",
      "recipe-list": "recipe-list [--status ACTIVE|STALE|ARCHIVED]",
      "recipe-match": "recipe-match --context-json <json>",
      "recipe-outcome": "recipe-outcome --id <id> --outcome SUCCESS|FAILED",
      "recipe-pin": "recipe-pin --id <id> [--pinned true|false]",
      "recipe-archive": "recipe-archive --id <id>",
      "recipe-activate": "recipe-activate --id <id>",
      "curator-status": "curator-status [--stale-days 90] [--archive-days 180]",
      curate: "curate [--apply] [--stale-days 90] [--archive-days 180]",
      backup: "backup [--reason <text>]",
      backups: "backups",
      rollback: "rollback --backup <id> [--apply]",
    },
  };
}

function main(argv) {
  const [command = "help", ...rest] = argv;
  const args = parseArgs(rest);
  const root = args.root ?? process.cwd();
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      return help();
    case "run":
      return { learning: runLearningPhase(root, required(args, "dir")) };
    case "lesson-list":
      return { lessons: listLessons(root, { status: args.status }) };
    case "lesson-validate":
      return {
        lesson: validateLesson(root, required(args, "id"), {
          type: required(args, "evidence-type"),
          source: required(args, "source"),
          status: args.status,
          details: args["details-json"] ? jsonArg(args["details-json"]) : undefined,
        }, { actor: args.actor }),
      };
    case "recipe-promote":
      return (() => {
        const backup = createKnowledgeBackup(root, { reason: "before-recipe-promotion" });
        return {
          backup,
          recipe: promoteLessonToRecipe(root, required(args, "lesson"), {
          recipeId: args["recipe-id"],
          minimumConfidence: numberArg(args["minimum-confidence"]),
          }),
        };
      })();
    case "recipe-list":
      return { recipes: listRecipes(root, { status: args.status }) };
    case "recipe-match":
      return {
        matches: matchRecipes(root, jsonArg(required(args, "context-json")), {
          limit: numberArg(args.limit),
        }),
      };
    case "recipe-outcome":
      return {
        recipe: recordRecipeOutcome(root, required(args, "id"), required(args, "outcome"), {
          runId: args["run-id"],
          taskId: args["task-id"],
          evidence: args["evidence-json"] ? jsonArg(args["evidence-json"]) : [],
        }),
      };
    case "recipe-pin":
      return (() => {
        const id = required(args, "id");
        const backup = createKnowledgeBackup(root, { reason: `before-recipe-pin-${id}` });
        return { backup, recipe: setRecipePinned(root, id, boolArg(args.pinned, true)) };
      })();
    case "recipe-archive":
      return (() => {
        const id = required(args, "id");
        const backup = createKnowledgeBackup(root, { reason: `before-recipe-archive-${id}` });
        return { backup, recipe: archiveRecipe(root, id, { explicit: true }) };
      })();
    case "recipe-activate":
      return (() => {
        const id = required(args, "id");
        const backup = createKnowledgeBackup(root, { reason: `before-recipe-activate-${id}` });
        return { backup, recipe: activateRecipe(root, id) };
      })();
    case "curator-status":
      return {
        status: curatorStatus(root, {
          staleDays: numberArg(args["stale-days"]),
          archiveDays: numberArg(args["archive-days"]),
        }),
      };
    case "curate":
      return curateKnowledge(root, {
        dryRun: !boolArg(args.apply, false),
        staleDays: numberArg(args["stale-days"]),
        archiveDays: numberArg(args["archive-days"]),
      });
    case "backup":
      return { backup: createKnowledgeBackup(root, { reason: args.reason }) };
    case "backups":
      return { backups: listKnowledgeBackups(root) };
    case "rollback":
      return rollbackKnowledge(root, required(args, "backup"), {
        dryRun: !boolArg(args.apply, false),
      });
    default: {
      const error = new Error(`Unknown command: ${command}`);
      error.code = "UNKNOWN_COMMAND";
      throw error;
    }
  }
}

executeJsonCli(main);
