export function renderReviewPrompt(review) {
  const lines = [];
  lines.push('# Cross Review Request');
  lines.push('');
  lines.push(`Review ID: ${review.id}`);
  lines.push(`Review Type: ${review.reviewType || 'PLAN_AND_PROPOSAL'}`);
  lines.push(`Source Host: ${review.source}`);
  lines.push(`Target Host: ${review.target}`);
  lines.push('');

  const type = review.reviewType || 'PLAN_AND_PROPOSAL';

  lines.push('## Review Goal');
  if (review.reviewGoal) {
    lines.push(review.reviewGoal);
  } else if (type === 'PLAN_AND_PROPOSAL') {
    lines.push('Act as a Plan Critic & Peer Logic Checker. Critically review the proposed plan or answer for missing edge cases, architectural trade-offs, constraint/ADR violations, and potential blind spots.');
  } else if (type === 'CODE_DIFF') {
    lines.push('Act as a Spec & Code Validator. Critically review the code changes and diffs for correctness, specification compliance, security/edge case risks, and test coverage.');
  } else {
    lines.push('Critically review the answer for correctness, missing assumptions, risks, and actionable improvements.');
  }
  lines.push('');

  lines.push('## Review Guide');
  lines.push(review.reviewGuide || 'Prioritize concrete issues over general commentary. Separate must-fix items (P0/P1) from optional suggestions (P2/P3).');
  lines.push('');

  if (Array.isArray(review.reviewQuestions) && review.reviewQuestions.length > 0) {
    lines.push('## Key Questions To Address');
    for (const q of review.reviewQuestions) {
      lines.push(`- ${q}`);
    }
    lines.push('');
  }

  if (review.proposedPlanDoc) {
    lines.push('## Proposed Plan File');
    lines.push(`### ${review.proposedPlanDoc.path}`);
    if (review.proposedPlanDoc.error) {
      lines.push(`*(Warning: ${review.proposedPlanDoc.error})*`);
    }
    if (review.proposedPlanDoc.content) {
      lines.push('```markdown');
      lines.push(review.proposedPlanDoc.content);
      lines.push('```');
      if (review.proposedPlanDoc.truncated) {
        lines.push('(Plan file was truncated.)');
      }
    }
    lines.push('');
  } else if (review.proposedPlanFile) {
    lines.push('## Proposed Plan File');
    lines.push(`Path: ${review.proposedPlanFile}`);
    lines.push('');
  }

  if (Array.isArray(review.contextDocs) && review.contextDocs.length > 0) {
    lines.push('## Context Documents');
    for (const doc of review.contextDocs) {
      lines.push(`### ${doc.path}`);
      if (doc.error) {
        lines.push(`*(Warning: ${doc.error})*`);
      }
      if (doc.content) {
        lines.push('```markdown');
        lines.push(doc.content);
        lines.push('```');
        if (doc.truncated) {
          lines.push('(Context document was truncated.)');
        }
      }
      lines.push('');
    }
  } else if (Array.isArray(review.contextDocuments) && review.contextDocuments.length > 0) {
    lines.push('## Context Documents');
    for (const doc of review.contextDocuments) {
      lines.push(`- ${doc}`);
    }
    lines.push('');
  }

  lines.push('## Project Context');
  if (review.project) {
    lines.push(`Project root: ${review.project.root || 'unknown'}`);
    lines.push(`Current working directory: ${review.project.cwd || 'unknown'}`);
    if (review.project.git) {
      lines.push(`Git branch: ${review.project.git.branch || '(unknown)'}`);
      lines.push('Git status summary:');
      lines.push('```text');
      lines.push(review.project.git.statusShort || '(clean or unavailable)');
      lines.push('```');
    }
    if (review.project.instructions?.length) {
      for (const instruction of review.project.instructions) {
        lines.push('');
        lines.push(`### ${instruction.path}`);
        lines.push('```markdown');
        lines.push(instruction.content);
        lines.push('```');
        if (instruction.truncated) {
          lines.push('(Instruction file was truncated.)');
        }
      }
    } else {
      lines.push('No project instruction files were captured.');
    }
  } else {
    lines.push('No project context was provided.');
  }
  lines.push('');
  lines.push('## Answer Or Proposal To Review');
  lines.push('```markdown');
  lines.push(review.subject);
  lines.push('```');
  lines.push('');
  lines.push('## Output Format');
  lines.push('- Findings first, ordered by severity.');
  lines.push('- Use `P0`, `P1`, `P2`, `P3` labels when useful.');
  lines.push('- Explain why each issue matters and what to change.');
  if (type === 'PLAN_AND_PROPOSAL') {
    lines.push('- Highlight any unaddressed edge cases, missing ADR constraints, or alternative trade-offs.');
  }
  lines.push('- End with one of: `accept`, `revise`, or `reject`.');

  return `${lines.join('\n')}\n`;
}


