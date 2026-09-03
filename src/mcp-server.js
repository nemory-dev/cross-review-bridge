#!/usr/bin/env node
import readline from 'node:readline';

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

const tools = [
  {
    name: 'submit_review',
    description: 'Submit an assistant answer or proposal for cross-review by another AI host.',
    inputSchema: {
      type: 'object',
      required: ['target', 'subject'],
      properties: {
        storePath: { type: 'string' },
        target: { type: 'string', description: 'Reviewer target, e.g. claude, codex, antigravity.' },
        source: { type: 'string', description: 'Source host, e.g. codex or claude.' },
        subject: { type: 'string', description: 'The answer, plan, or proposal to review.' },
        reviewType: {
          type: 'string',
          enum: ['PLAN_AND_PROPOSAL', 'CODE_DIFF', 'GENERAL'],
          description: 'Review type: PLAN_AND_PROPOSAL, CODE_DIFF, or GENERAL.'
        },
        reviewGoal: { type: 'string' },
        reviewGuide: { type: 'string' },
        proposedPlanFile: { type: 'string', description: 'Path to proposed plan document file.' },
        contextDocuments: { type: 'array', items: { type: 'string' }, description: 'Paths to additional context/ADR files.' },
        reviewQuestions: { type: 'array', items: { type: 'string' }, description: 'Specific questions to review.' },
        cwd: { type: 'string', description: 'Project cwd for instruction/context discovery.' }
      }
    }
  },
  {
    name: 'list_reviews',
    description: 'List review requests by status or target.',
    inputSchema: {
      type: 'object',
      properties: {
        storePath: { type: 'string' },
        status: { type: 'string' },
        target: { type: 'string' }
      }
    }
  },
  {
    name: 'claim_review',
    description: 'Claim the next pending review for a target and return it.',
    inputSchema: {
      type: 'object',
      required: ['target'],
      properties: {
        storePath: { type: 'string' },
        target: { type: 'string' },
        reviewer: { type: 'string' }
      }
    }
  },
  {
    name: 'complete_review',
    description: 'Attach review feedback and mark a review as completed.',
    inputSchema: {
      type: 'object',
      required: ['id', 'result'],
      properties: {
        storePath: { type: 'string' },
        id: { type: 'string' },
        reviewer: { type: 'string' },
        result: { type: 'string' }
      }
    }
  },
  {
    name: 'get_review',
    description: 'Get one review request and any completed feedback.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        storePath: { type: 'string' },
        id: { type: 'string' }
      }
    }
  },
  {
    name: 'render_review_prompt',
    description: 'Render a claimed or pending review as a reviewer-ready prompt.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        storePath: { type: 'string' },
        id: { type: 'string' }
      }
    }
  },
  {
    name: 'cancel_review',
    description: 'Cancel a review request.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        storePath: { type: 'string' },
        id: { type: 'string' },
        reason: { type: 'string' }
      }
    }
  }
];

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY
});

// Requests are handled one at a time. readline emits `line` synchronously, so an
// async listener would interleave at every await: two claim_review calls arriving
// together would both read the same pending review and both report a win.
let pending = Promise.resolve();

rl.on('line', (line) => {
  pending = pending.then(() => handleLine(line)).catch(() => {});
});

async function handleLine(line) {
  if (!line.trim()) return;

  let request;
  try {
    request = JSON.parse(line);
    if (!request.id && request.method === 'notifications/initialized') {
      return;
    }
    const result = await handleRequest(request.method, request.params || {});
    writeMessage({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) {
    writeMessage({
      jsonrpc: '2.0',
      id: request?.id ?? null,
      error: {
        code: -32000,
        message: error.message
      }
    });
  }
}

async function handleRequest(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: '2025-06-18',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'cross-review-bridge',
          version: '0.1.0'
        }
      };

    case 'tools/list':
      return { tools };

    case 'tools/call':
      return callTool(params.name, params.arguments || {});

    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

async function callTool(name, args) {
  const storePath = args.storePath || defaultStorePath();

  switch (name) {
    case 'submit_review': {
      const project = await collectProjectContext({ cwd: args.cwd || process.cwd() });
      const review = await createReview({
        storePath,
        target: args.target,
        source: args.source || 'unknown',
        subject: args.subject,
        reviewType: args.reviewType || 'PLAN_AND_PROPOSAL',
        reviewGoal: args.reviewGoal || '',
        reviewGuide: args.reviewGuide || '',
        proposedPlanFile: args.proposedPlanFile || '',
        contextDocuments: args.contextDocuments || [],
        reviewQuestions: args.reviewQuestions || [],
        project
      });
      return textResult(JSON.stringify(review, null, 2));
    }

    case 'list_reviews': {
      const reviews = await listReviews({
        storePath,
        status: args.status || null,
        target: args.target || null
      });
      return textResult(JSON.stringify(reviews, null, 2));
    }

    case 'claim_review': {
      const review = await claimReview({
        storePath,
        target: args.target,
        reviewer: args.reviewer || 'unknown'
      });
      return textResult(JSON.stringify(review, null, 2));
    }

    case 'complete_review': {
      const review = await completeReview({
        storePath,
        id: args.id,
        reviewer: args.reviewer || 'unknown',
        result: args.result
      });
      return textResult(JSON.stringify(review, null, 2));
    }

    case 'get_review': {
      const review = await getReview({ storePath, id: args.id });
      return textResult(JSON.stringify(review, null, 2));
    }

    case 'render_review_prompt': {
      const review = await getReview({ storePath, id: args.id });
      return textResult(renderReviewPrompt(review));
    }

    case 'cancel_review': {
      const review = await cancelReview({
        storePath,
        id: args.id,
        reason: args.reason || ''
      });
      return textResult(JSON.stringify(review, null, 2));
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function textResult(text) {
  return {
    content: [
      {
        type: 'text',
        text
      }
    ]
  };
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

