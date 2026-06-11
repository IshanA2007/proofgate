import type { AttestationResult } from './types';

const HEADING_RE = /^(#{2,6})\s*ProofGate Attestation\s*$/im;
const AI_TOOLS_RE = /ai tools used:?[ \t]*(.*)/i;
const CHECKED_RE = /^\s*[-*]\s*\[[xX]\]/gm;
const UNCHECKED_RE = /^\s*[-*]\s*\[ \]/gm;

/** The minimum number of checklist items the attestation template ships with. */
const REQUIRED_ITEMS = 3;

/**
 * Parses the contributor attestation out of a PR description. The attestation
 * is a "### ProofGate Attestation" section containing an "AI tools used:"
 * disclosure line and three checkboxes (disclosure, ran tests locally, can
 * explain the change).
 */
export function parseAttestation(body: string | null | undefined): AttestationResult {
  const heading = body ? HEADING_RE.exec(body) : null;
  if (!body || !heading) {
    return {
      status: 'missing',
      missingItems: ['No "ProofGate Attestation" section in the PR description'],
    };
  }

  // The section runs until the next heading of the same or higher level;
  // deeper sub-headings stay inside it.
  const level = heading[1]!.length;
  const afterHeading = body.slice(heading.index).replace(/^.*\n?/, '');
  const nextHeading = afterHeading.search(new RegExp(`^#{1,${level}}\\s`, 'm'));
  const rawSection = nextHeading === -1 ? afterHeading : afterHeading.slice(0, nextHeading);
  // Drop HTML comments so template placeholders don't count as answers.
  const section = rawSection.replace(/<!--[\s\S]*?-->/g, '');

  const missingItems: string[] = [];

  const aiMatch = AI_TOOLS_RE.exec(section);
  const aiValue = aiMatch?.[1]?.trim() ?? '';
  let aiToolsUsed: string | undefined;
  if (!aiMatch) {
    missingItems.push('No "AI tools used:" line found');
  } else if (!aiValue) {
    missingItems.push('The "AI tools used:" line is empty — name the tools or write "none"');
  } else {
    aiToolsUsed = aiValue;
  }

  const checked = section.match(CHECKED_RE) ?? [];
  const unchecked = section.match(UNCHECKED_RE) ?? [];
  if (unchecked.length > 0) {
    missingItems.push(`${unchecked.length} attestation checkbox(es) left unchecked`);
  }
  if (checked.length + unchecked.length < REQUIRED_ITEMS) {
    missingItems.push(
      `Attestation checklist is incomplete — expected at least ${REQUIRED_ITEMS} items (was the template altered?)`,
    );
  }

  if (missingItems.length === 0) {
    return { status: 'complete', aiToolsUsed, missingItems: [] };
  }
  return { status: 'incomplete', aiToolsUsed, missingItems };
}
