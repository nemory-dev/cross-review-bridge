#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

import { collectProjectContext } from './context.js';
import { renderReviewPrompt } from './prompt.js';
import {
  cancelReview,
  claimReview,
  completeReview,
  createReview,
  defaultStorePath,
  getReview,
  listReviews,
  normalizeReviewType
} from './store.js';

async function main(argv) {
  const [command, ...rest] = argv;
  const options = parseArgs(rest);
  const storePath = options.store || defaultStorePath();

  switch (command) {
    case 'review':
    case 'submit': {
      const source = options.source || 'codex';
      const subject = await readSubject(options);
      const project = await collectProjectContext({ cwd: options.cwd || process.cwd() });
      const reviewType = parseReviewType(options.type);
      const proposedPlanFile = options['plan-file'] || options.planFile || '';
      const contextDocuments = collectArrayOption(options, ['context-docs', 'context-doc', 'contextDocs']);
      const reviewQuestions = collectArrayOption(options, ['question', 'questions']);

      const hasExplicitType = Boolean(options.type);
      const review = await createReview({
        storePath,
        target: options.target || defaultTargetForSource(source),
        source,
        subject,
        reviewType,
        reviewGoal: options.goal || (hasExplicitType ? '' : defaultReviewGoal(command)),
        reviewGuide: options.guide || (hasExplicitType ? '' : defaultReviewGuide(command)),
        proposedPlanFile,
        contextDocuments,
        reviewQuestions,
        project
      });
      printJson(review);
      break;
    }

    case 'pending':
    case 'list': {
      const reviews = await listReviews({
        storePath,
        status: options.status || (command === 'pending' ? 'pending' : null),
        target: options.target || null
      });
      printJson(reviews);
      break;
    }

    case 'claim': {
      const review = await claimReview({
        storePath,
        target: requireOption(options, 'target'),
        reviewer: options.reviewer || 'unknown'
      });
      if (!review) {
        printJson(null);
        break;
      }
      printReview(review, options.format || 'json');
      break;
    }

    case 'complete': {
      const id = options._[0];
      const result = await readResult(options);
      const review = await completeReview({
        storePath,
        id: id || requireOption(options, 'id'),
        reviewer: options.reviewer || 'unknown',
        result
      });
      printJson(review);
      break;
    }

    case 'show': {
      const id = options._[0] || requireOption(options, 'id');
      const review = await getReview({ storePath, id });
      printReview(review, options.format || 'json');
      break;
    }

    case 'prompt': {
      const id = options._[0] || requireOption(options, 'id');
      const review = await getReview({ storePath, id });
      process.stdout.write(renderReviewPrompt(review));
      break;
    }

    case 'cancel': {
      const id = options._[0] || requireOption(options, 'id');
      const review = await cancelReview({
        storePath,
        id,
        reason: options.reason || ''
      });
      printJson(review);
      break;
    }

    case 'help':
    case '--help':
    case '-h':
    case undefined:
      printHelp();
      break;

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function parseArgs(args) {
  const options = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      options._.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = args[index + 1];
    let val;
    if (next === undefined || next.startsWith('--')) {
      val = true;
    } else {
      val = next;
      index += 1;
    }

    if (options[key] !== undefined) {
      if (Array.isArray(options[key])) {
        options[key].push(val);
      } else {
        options[key] = [options[key], val];
      }
    } else {
      options[key] = val;
    }
  }
  return options;
}

function parseReviewType(typeOpt) {
  return normalizeReviewType(typeOpt);
}

function collectArrayOption(options, keys) {
  const result = [];
  for (const key of keys) {
    const val = options[key];
    if (!val) continue;
    if (Array.isArray(val)) {
      result.push(...val);
    } else if (typeof val === 'string') {
      if (val.includes(',')) {
        result.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
      } else {
        result.push(val);
      }
    }
  }
  return result;
}

async function readSubject(options) {
  if (options.subject) return options.subject;
  if (options['subject-file']) {
    return readFile(options['subject-file'], 'utf8');
  }
  if (options._.length) return options._.join(' ');
  throw new Error('Missing required option: --subject or --subject-file');
}

async function readResult(options) {
  if (options.result) return options.result;
  if (options['result-file']) {
    return readFile(options['result-file'], 'utf8');
  }
  throw new Error('Missing required option: --result or --result-file');
}

function printReview(review, format) {
  if (format === 'prompt') {
    process.stdout.write(renderReviewPrompt(review));
    return;
  }
  if (format === 'summary') {
    process.stdout.write(`${review.id}\t${review.status}\t${review.source}->${review.target}\n`);
    return;
  }
  printJson(review);
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function requireOption(options, name) {
  if (!options[name]) {
    throw new Error(`Missing required option: --${name}`);
  }
  return options[name];
}

function defaultTargetForSource(source) {
  if (source === 'claude') return 'codex';
  if (source === 'codex') return 'claude';
  return 'claude';
}

function defaultReviewGoal(command) {
  if (command === 'review') return 'Critically review this answer or plan.';
  return '';
}

function defaultReviewGuide(command) {
  if (command === 'review') {
    return 'Focus on correctness, missing assumptions, risks, and actionable improvements.';
  }
  return '';
}

function printHelp() {
  process.stdout.write(`cross-review-bridge CLI

Usage:
  xreview review "text" [--type plan|code|general] [--source codex|claude] [--target claude|codex]
  xreview submit "text" [--type plan|code|general] [--source codex|claude] [--target claude|codex]
  xreview submit --target claude --type plan --subject "text" [--plan-file plan.md] [--question "q1"] [--question "q2"]
  xreview submit --target claude --subject-file answer.md
  xreview pending [--target claude]
  xreview claim --target claude --reviewer claude-code [--format prompt]
  xreview complete <id> --result-file review.md --reviewer claude-code
  xreview show <id> [--format json|prompt|summary]
  xreview prompt <id>
  xreview cancel <id> [--reason "..."]

Options:
  --store <path>          Override review store path.
  --cwd <path>            Project cwd used for context collection.
  --type <type>           Review type: plan (PLAN_AND_PROPOSAL), code (CODE_DIFF), general. Defaults to plan.
  --plan-file <path>      Path to proposed plan file.
  --context-docs <paths>  Paths to context/ADR files (comma-separated or multiple flags).
  --question <q>          Specific review questions for reviewer (can be specified multiple times).
  --source <name>         Source host. Defaults to codex.
  --target <name>         Reviewer host. Defaults to claude for codex, codex for claude.
`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
