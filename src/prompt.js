export function renderReviewPrompt(review) {
  const lines = [];
  lines.push('# Cross Review Request');
  lines.push('');
  lines.push(`Review ID: ${review.id}`);
  lines.push(`Source: ${review.source}`);
  lines.push(`Target: ${review.target}`);
  lines.push('');
  lines.push('## Review Goal');
  lines.push(review.reviewGoal || 'Critically review the answer for correctness, missing assumptions, risks, and actionable improvements.');
  lines.push('');
  lines.push('## Review Guide');
  lines.push(review.reviewGuide || 'Prioritize concrete issues over general commentary. Separate must-fix items from optional suggestions.');
  lines.push('');
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
  lines.push('- End with one of: `accept`, `revise`, or `reject`.');

  return `${lines.join('\n')}\n`;
}

