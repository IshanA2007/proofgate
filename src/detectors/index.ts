import type { ChangedFile, Finding } from '../types';
import { detectCiTampering } from './ciTampering';
import { detectDeletedTests } from './deletedTests';
import { detectSkippedTests } from './skippedTests';
import { detectWeakenedAssertions } from './weakenedAssertions';

export function runDetectors(files: ChangedFile[]): Finding[] {
  return [
    ...detectDeletedTests(files),
    ...detectSkippedTests(files),
    ...detectWeakenedAssertions(files),
    ...detectCiTampering(files),
  ];
}
