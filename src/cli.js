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
  listReviews
} from './store.js';

async function main(argv) {
  const [command, ...rest] = argv;
  const options = parseArgs(rest);
  const storePath = options.store || defaultStorePath();

  switch (command) {
    case 'submit': {
      const subject = await readSubject(options);
      const project = await collectProjectContext({ cwd: options.cwd || process.cwd() });
      const review = await createReview({
        storePath,
        target: requireOption(options, 'target'),
        source: options.source || 'unknown',
        subject,
        reviewGoal: options.goal || '',
        reviewGuide: options.guide || '',
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
    if (next === undefined || next.startsWith('--')) {
      options[key] = true;
    } else {
      options[key] = next;
      index += 1;
    }
  }
  return options;
}

async function readSubject(options) {
  if (options.subject) return options.subject;
  if (options['subject-file']) {
    return readFile(options['subject-file'], 'utf8');
  }
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

function printHelp() {
  process.stdout.write(`cross-review-bridge CLI

Usage:
  xreview submit --target claude --subject "text" [--goal "..."] [--guide "..."]
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
`);
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
