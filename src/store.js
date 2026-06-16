import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const VALID_STATUSES = new Set(['pending', 'claimed', 'completed', 'cancelled']);

export function defaultStorePath() {
  const base = process.env.CROSS_REVIEW_HOME || path.join(homedir(), '.cross-review-bridge');
  return path.join(base, 'reviews.json');
}

export async function createReview({
  storePath = defaultStorePath(),
  target,
  source = 'unknown',
  subject,
  reviewGoal = '',
  reviewGuide = '',
  project = null,
  metadata = {}
}) {
  requireText(target, 'target');
  requireText(subject, 'subject');

  const now = new Date().toISOString();
  const review = {
    id: randomUUID(),
    status: 'pending',
    target,
    source,
    subject,
    reviewGoal,
    reviewGuide,
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

