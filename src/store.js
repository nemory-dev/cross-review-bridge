import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

import { readContextDocument, toPosixPath } from './context.js';

const VALID_STATUSES = new Set(['pending', 'claimed', 'completed', 'cancelled']);
export const VALID_REVIEW_TYPES = new Set(['PLAN_AND_PROPOSAL', 'CODE_DIFF', 'GENERAL']);

export function normalizeReviewType(typeOpt) {
  if (!typeOpt || typeof typeOpt !== 'string') return 'PLAN_AND_PROPOSAL';
  const upper = typeOpt.trim().toUpperCase();
  const lower = typeOpt.trim().toLowerCase();

  if (lower === 'plan' || lower === 'proposal' || lower === 'plan_and_proposal') return 'PLAN_AND_PROPOSAL';
  if (lower === 'code' || lower === 'diff' || lower === 'code_diff') return 'CODE_DIFF';
  if (lower === 'general') return 'GENERAL';

  if (VALID_REVIEW_TYPES.has(upper)) {
    return upper;
  }
  throw new Error(`Invalid reviewType: "${typeOpt}". Allowed values: ${Array.from(VALID_REVIEW_TYPES).join(', ')}`);
}

export const MAX_TOTAL_CONTEXT_CHARS = 36000;

// Context documents honour a budget but the subject used to be uncapped, so a
// large --subject-file could inflate the prompt without limit. Reject instead of
// truncating: a diff cut in half produces a review of code that does not exist.
export const MAX_SUBJECT_CHARS = 120000;

export function defaultStorePath() {
  const base = process.env.CROSS_REVIEW_HOME || path.join(homedir(), '.cross-review-bridge');
  return path.join(base, 'reviews.json');
}

export async function createReview({
  storePath = defaultStorePath(),
  target,
  source = 'unknown',
  subject,
  reviewType = 'PLAN_AND_PROPOSAL',
  reviewGoal = '',
  reviewGuide = '',
  proposedPlanFile = '',
  contextDocuments = [],
  reviewQuestions = [],
  project = null,
  metadata = {}
}) {
  requireText(target, 'target');
  requireText(subject, 'subject');

  if (subject.length > MAX_SUBJECT_CHARS) {
    throw new Error(
      `Subject is too large: ${subject.length} characters exceeds the limit of ${MAX_SUBJECT_CHARS}. Trim the subject or split the review.`
    );
  }

  const validReviewType = normalizeReviewType(reviewType);
  const projectRoot = project?.root || process.cwd();
  let remainingBudget = MAX_TOTAL_CONTEXT_CHARS;

  let proposedPlanDoc = null;
  if (proposedPlanFile) {
    proposedPlanDoc = await readContextDocument(projectRoot, proposedPlanFile, Math.min(12000, remainingBudget));
    if (proposedPlanDoc?.content) {
      remainingBudget = Math.max(0, remainingBudget - proposedPlanDoc.content.length);
    }
  }

  const contextDocs = [];
  if (Array.isArray(contextDocuments)) {
    for (const docPath of contextDocuments) {
      if (remainingBudget <= 0) {
        const display = toPosixPath(docPath);
        contextDocs.push({
          path: display,
          nativePath: path.resolve(projectRoot, docPath),
          content: null,
          truncated: true,
          error: `Omitted: Total context size budget (${MAX_TOTAL_CONTEXT_CHARS} chars) exceeded.`
        });
        continue;
      }
      const doc = await readContextDocument(projectRoot, docPath, Math.min(12000, remainingBudget));
      if (doc) {
        contextDocs.push(doc);
        if (doc.content) {
          remainingBudget = Math.max(0, remainingBudget - doc.content.length);
        }
      }
    }
  }

  const now = new Date().toISOString();
  const review = {
    id: randomUUID(),
    status: 'pending',
    target,
    source,
    subject,
    reviewType: validReviewType,
    reviewGoal,
    reviewGuide,
    proposedPlanFile: proposedPlanDoc?.path || toPosixPath(proposedPlanFile),
    proposedPlanDoc,
    contextDocuments: contextDocs.length > 0 ? contextDocs.map((d) => d.path) : (Array.isArray(contextDocuments) ? contextDocuments.map(toPosixPath) : []),
    contextDocs,
    reviewQuestions: Array.isArray(reviewQuestions) ? reviewQuestions : [],
    project,
    metadata,
    createdAt: now,
    updatedAt: now
  };

  const data = await readStore(storePath);
  data.reviews.push(review);
  await writeStore(storePath, data);
  return review;
}

export async function listReviews({
  storePath = defaultStorePath(),
  status = null,
  target = null
} = {}) {
  if (status && !VALID_STATUSES.has(status)) {
    throw new Error(`Invalid review status: ${status}`);
  }

  const data = await readStore(storePath);
  return data.reviews.filter((review) => {
    if (status && review.status !== status) return false;
    if (target && review.target !== target) return false;
    return true;
  });
}

export async function getReview({ storePath = defaultStorePath(), id }) {
  requireText(id, 'id');
  const data = await readStore(storePath);
  const review = data.reviews.find((item) => item.id === id);
  if (!review) {
    throw new Error(`Review not found: ${id}`);
  }
  return review;
}

export async function claimReview({
  storePath = defaultStorePath(),
  target,
  reviewer = 'unknown'
}) {
  requireText(target, 'target');
  const data = await readStore(storePath);
  const review = data.reviews.find((item) => item.status === 'pending' && item.target === target);

  if (!review) {
    return null;
  }

  review.status = 'claimed';
  review.claimedBy = reviewer;
  review.claimedAt = new Date().toISOString();
  review.updatedAt = review.claimedAt;
  await writeStore(storePath, data);
  return review;
}

export async function completeReview({
  storePath = defaultStorePath(),
  id,
  reviewer = 'unknown',
  result
}) {
  requireText(id, 'id');
  requireText(result, 'result');

  const data = await readStore(storePath);
  const review = data.reviews.find((item) => item.id === id);
  if (!review) {
    throw new Error(`Review not found: ${id}`);
  }
  if (review.status === 'cancelled') {
    throw new Error(`Cannot complete cancelled review: ${id}`);
  }
  if (review.status === 'completed') {
    throw new Error(
      `Review ${id} is already completed and its result is immutable. Submit a new review for another round.`
    );
  }
  if (review.status !== 'claimed') {
    throw new Error(`Review ${id} must be claimed before it can be completed (status: ${review.status}).`);
  }
  if (review.claimedBy && review.claimedBy !== reviewer) {
    throw new Error(
      `Review ${id} was claimed by "${review.claimedBy}"; reviewer "${reviewer}" cannot complete it.`
    );
  }

  const now = new Date().toISOString();
  review.status = 'completed';
  review.result = {
    reviewer,
    body: result,
    completedAt: now
  };
  review.updatedAt = now;
  await writeStore(storePath, data);
  return review;
}

export async function cancelReview({
  storePath = defaultStorePath(),
  id,
  reason = ''
}) {
  requireText(id, 'id');
  const data = await readStore(storePath);
  const review = data.reviews.find((item) => item.id === id);
  if (!review) {
    throw new Error(`Review not found: ${id}`);
  }
  if (review.status === 'completed') {
    throw new Error(`Review ${id} is already completed and cannot be cancelled.`);
  }
  if (review.status === 'cancelled') {
    return review;
  }

  const now = new Date().toISOString();
  review.status = 'cancelled';
  review.cancelReason = reason;
  review.updatedAt = now;
  await writeStore(storePath, data);
  return review;
}

async function readStore(storePath) {
  try {
    const raw = await readFile(storePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.reviews)) {
      return { reviews: [] };
    }
    return parsed;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { reviews: [] };
    }
    throw error;
  }
}

async function writeStore(storePath, data) {
  await mkdir(path.dirname(storePath), { recursive: true });
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(tempPath, storePath);
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required field: ${field}`);
  }
}

