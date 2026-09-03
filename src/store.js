import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
  return path.join(base, 'reviews.db');
}

// The store is SQLite rather than a JSON file because several hosts share it:
// a Codex MCP server, a Claude MCP server, and the xreview CLI are separate
// processes writing the same path. A read-modify-write over JSON loses updates
// between them, and on Windows concurrent renames onto one destination fail
// outright. See docs/orca-comparison-review.md sections B1, C1, and D4.
function openStore(storePath) {
  mkdirSync(path.dirname(storePath), { recursive: true });

  const db = new DatabaseSync(storePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  // Concurrent writers wait for the lock instead of failing with SQLITE_BUSY.
  db.exec('PRAGMA busy_timeout = 5000');

  const isNew = !db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reviews'")
    .get();

  db.exec(`CREATE TABLE IF NOT EXISTS reviews (
    id         TEXT PRIMARY KEY,
    status     TEXT NOT NULL,
    target     TEXT NOT NULL,
    created_at TEXT NOT NULL,
    claimed_by TEXT,
    data       TEXT NOT NULL
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS reviews_by_queue ON reviews (target, status, created_at)');

  if (isNew) {
    importLegacyJsonStore(db, storePath);
  }

  return db;
}

// One-time carry-over from the pre-SQLite layout. The JSON file is left in place
// rather than deleted, so a mistaken migration stays recoverable.
function importLegacyJsonStore(db, storePath) {
  const legacyPath = path.join(path.dirname(storePath), 'reviews.json');
  if (!existsSync(legacyPath)) return;

  let reviews;
  try {
    reviews = JSON.parse(readFileSync(legacyPath, 'utf8')).reviews;
  } catch {
    return;
  }
  if (!Array.isArray(reviews)) return;

  const insert = db.prepare(
    'INSERT OR IGNORE INTO reviews (id, status, target, created_at, claimed_by, data) VALUES (?, ?, ?, ?, ?, ?)'
  );
  transact(db, () => {
    for (const review of reviews) {
      if (!review?.id) continue;
      insert.run(
        review.id,
        review.status ?? 'pending',
        review.target ?? '',
        review.createdAt ?? new Date(0).toISOString(),
        review.claimedBy ?? null,
        JSON.stringify(review)
      );
    }
  });
}

function withStore(storePath, run) {
  const db = openStore(storePath);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

// BEGIN IMMEDIATE takes the write lock up front, so a select-then-update pair
// cannot interleave with another writer's.
function transact(db, run) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = run();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // The transaction is already gone; surface the original failure.
    }
    throw error;
  }
}

function persist(db, review) {
  db.prepare(
    `INSERT INTO reviews (id, status, target, created_at, claimed_by, data)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status, claimed_by = excluded.claimed_by, data = excluded.data`
  ).run(review.id, review.status, review.target, review.createdAt, review.claimedBy ?? null, JSON.stringify(review));
}

function loadReview(db, id) {
  const row = db.prepare('SELECT data FROM reviews WHERE id = ?').get(id);
  return row ? JSON.parse(row.data) : null;
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

  withStore(storePath, (db) => persist(db, review));
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

  const filters = [];
  const values = [];
  if (status) {
    filters.push('status = ?');
    values.push(status);
  }
  if (target) {
    filters.push('target = ?');
    values.push(target);
  }
  const where = filters.length > 0 ? ` WHERE ${filters.join(' AND ')}` : '';

  return withStore(storePath, (db) =>
    db
      .prepare(`SELECT data FROM reviews${where} ORDER BY created_at, id`)
      .all(...values)
      .map((row) => JSON.parse(row.data))
  );
}

export async function getReview({ storePath = defaultStorePath(), id }) {
  requireText(id, 'id');
  const review = withStore(storePath, (db) => loadReview(db, id));
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

  return withStore(storePath, (db) =>
    transact(db, () => {
      const row = db
        .prepare(
          "SELECT data FROM reviews WHERE target = ? AND status = 'pending' ORDER BY created_at, id LIMIT 1"
        )
        .get(target);

      if (!row) {
        return null;
      }

      const review = JSON.parse(row.data);
      review.status = 'claimed';
      review.claimedBy = reviewer;
      review.claimedAt = new Date().toISOString();
      review.updatedAt = review.claimedAt;
      persist(db, review);
      return review;
    })
  );
}

export async function completeReview({
  storePath = defaultStorePath(),
  id,
  reviewer = 'unknown',
  result
}) {
  requireText(id, 'id');
  requireText(result, 'result');

  return withStore(storePath, (db) =>
    transact(db, () => {
      const review = loadReview(db, id);
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
      persist(db, review);
      return review;
    })
  );
}

export async function cancelReview({
  storePath = defaultStorePath(),
  id,
  reason = ''
}) {
  requireText(id, 'id');

  return withStore(storePath, (db) =>
    transact(db, () => {
      const review = loadReview(db, id);
      if (!review) {
        throw new Error(`Review not found: ${id}`);
      }
      if (review.status === 'completed') {
        throw new Error(`Review ${id} is already completed and cannot be cancelled.`);
      }
      if (review.status === 'cancelled') {
        return review;
      }

      review.status = 'cancelled';
      review.cancelReason = reason;
      review.updatedAt = new Date().toISOString();
      persist(db, review);
      return review;
    })
  );
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required field: ${field}`);
  }
}

