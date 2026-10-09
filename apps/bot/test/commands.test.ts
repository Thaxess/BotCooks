import { describe, expect, it } from 'vitest';
import { BUILTIN_COMMAND_NAMES } from '@botcooks/shared';
import { commandDefinitions, formatDuration, parseDuration } from '../src/commands/definitions';

describe('command definitions', () => {
  it('match the shared built-in name list (used to block custom-command clashes)', () => {
    expect(new Set(commandDefinitions.map((c) => c.name))).toEqual(BUILTIN_COMMAND_NAMES);
  });

  it('serialise to valid JSON payloads', () => {
    for (const c of commandDefinitions) {
      const json = c.toJSON();
      expect(json.name).toMatch(/^[a-z0-9_-]{1,32}$/);
      expect(json.description.length).toBeLessThanOrEqual(100);
    }
  });
});

describe('durations', () => {
  it('parses and formats', () => {
    expect(parseDuration('10m')).toBe(600);
    expect(parseDuration('2 h')).toBe(7200);
    expect(parseDuration('3d')).toBe(259200);
    expect(parseDuration('1w')).toBe(604800);
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('0m')).toBeNull();
    expect(formatDuration(5400)).toBe('90m');
  });
});
