import { describe, expect, it } from 'vitest';
import { parseAttestation } from '../src/attestation';

const COMPLETE_BODY = `
This PR fixes the retry logic.

### ProofGate Attestation

AI tools used: Claude Code

- [x] I have disclosed all AI assistance used to produce this PR above
- [x] I ran the project's full test suite locally and it passes
- [x] I understand this change and can explain every line of it
`;

describe('parseAttestation', () => {
  it('reports missing for an empty PR body', () => {
    expect(parseAttestation(null).status).toBe('missing');
    expect(parseAttestation('').status).toBe('missing');
  });

  it('reports missing when there is no attestation section', () => {
    const result = parseAttestation('Fixes #12.\n\n## Changes\n- stuff');
    expect(result.status).toBe('missing');
    expect(result.missingItems.length).toBeGreaterThan(0);
  });

  it('reports complete for a fully filled-out attestation', () => {
    const result = parseAttestation(COMPLETE_BODY);
    expect(result.status).toBe('complete');
    expect(result.aiToolsUsed).toBe('Claude Code');
    expect(result.missingItems).toEqual([]);
  });

  it('accepts uppercase X and alternate heading levels', () => {
    const body = COMPLETE_BODY.replace('### ProofGate', '## ProofGate').replace(
      /\[x\]/g,
      '[X]',
    );
    expect(parseAttestation(body).status).toBe('complete');
  });

  it('reports incomplete when a checkbox is unchecked', () => {
    const body = COMPLETE_BODY.replace(
      '- [x] I ran the project',
      '- [ ] I ran the project',
    );
    const result = parseAttestation(body);
    expect(result.status).toBe('incomplete');
    expect(result.missingItems.join(' ')).toContain('unchecked');
  });

  it('reports incomplete when the AI tools line is empty (placeholder comment only)', () => {
    const body = COMPLETE_BODY.replace(
      'AI tools used: Claude Code',
      'AI tools used: <!-- e.g. "GitHub Copilot" or "none" -->',
    );
    const result = parseAttestation(body);
    expect(result.status).toBe('incomplete');
    expect(result.missingItems.join(' ')).toContain('AI tools used');
  });

  it('reports incomplete when checkboxes were deleted from the template', () => {
    const body = `
### ProofGate Attestation

AI tools used: none

- [x] I understand this change and can explain every line of it
`;
    const result = parseAttestation(body);
    expect(result.status).toBe('incomplete');
    expect(result.missingItems.join(' ')).toContain('expected at least 3');
  });

  it('only considers content inside the attestation section', () => {
    const body = `${COMPLETE_BODY}
## Unrelated checklist
- [ ] follow-up work item
`;
    expect(parseAttestation(body).status).toBe('complete');
  });

  it('does not truncate the section at deeper sub-headings', () => {
    const body = `
### ProofGate Attestation

AI tools used: none

- [x] I have disclosed all AI assistance used to produce this PR above

#### Details

- [x] I ran the project's full test suite locally and it passes
- [x] I understand this change and can explain every line of it
`;
    expect(parseAttestation(body).status).toBe('complete');
  });

  it('treats "none" as a valid disclosure', () => {
    const body = COMPLETE_BODY.replace('AI tools used: Claude Code', 'AI tools used: none');
    const result = parseAttestation(body);
    expect(result.status).toBe('complete');
    expect(result.aiToolsUsed).toBe('none');
  });
});
