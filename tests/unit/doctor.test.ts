import { describe, it, expect } from 'vitest';
import {
  runDoctorChecks,
  formatDoctorResults,
  type DoctorCheck,
  type CheckFn,
} from '../../src/cli/doctor.js';

describe('runDoctorChecks', () => {
  it('runs all check functions and returns results', () => {
    const checks: CheckFn[] = [
      () => ({ name: 'Check A', passed: true, message: 'OK' }),
      () => ({ name: 'Check B', passed: false, message: 'Failed', fix: 'Do X' }),
    ];

    const results = runDoctorChecks(checks);

    expect(results).toHaveLength(2);
    expect(results[0].name).toBe('Check A');
    expect(results[0].passed).toBe(true);
    expect(results[1].name).toBe('Check B');
    expect(results[1].passed).toBe(false);
    expect(results[1].fix).toBe('Do X');
  });

  it('returns empty array for no checks', () => {
    const results = runDoctorChecks([]);
    expect(results).toHaveLength(0);
  });
});

describe('formatDoctorResults', () => {
  it('formats passing checks with checkmark', () => {
    const results: DoctorCheck[] = [
      { name: 'Database exists', passed: true, message: 'Found at /path/db' },
    ];

    const output = formatDoctorResults(results);
    expect(output).toContain('\u2714');
    expect(output).toContain('Database exists');
    expect(output).toContain('Found at /path/db');
    expect(output).toContain('1/1 checks passed');
  });

  it('formats failing checks with X and fix suggestion', () => {
    const results: DoctorCheck[] = [
      { name: 'Database exists', passed: false, message: 'Not found', fix: 'Run init' },
    ];

    const output = formatDoctorResults(results);
    expect(output).toContain('\u2718');
    expect(output).toContain('Database exists');
    expect(output).toContain('Not found');
    expect(output).toContain('Fix: Run init');
    expect(output).toContain('0/1 checks passed');
  });

  it('handles mix of passing and failing checks', () => {
    const results: DoctorCheck[] = [
      { name: 'A', passed: true, message: 'OK' },
      { name: 'B', passed: false, message: 'Bad', fix: 'Fix it' },
      { name: 'C', passed: true, message: 'Good' },
    ];

    const output = formatDoctorResults(results);
    expect(output).toContain('2/3 checks passed');
  });

  it('does not show fix line for passing checks', () => {
    const results: DoctorCheck[] = [
      { name: 'OK Check', passed: true, message: 'All good', fix: 'Should not show' },
    ];

    const output = formatDoctorResults(results);
    expect(output).not.toContain('Fix:');
  });

  it('does not show fix line when fix is undefined on failing check', () => {
    const results: DoctorCheck[] = [
      { name: 'Database', passed: false, message: 'Failed' },
    ];

    const output = formatDoctorResults(results);
    expect(output).toContain('\u2718');
    expect(output).not.toContain('    Fix:');
  });
});
