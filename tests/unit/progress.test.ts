import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Progress, AnimatedStatus } from '../../src/utils/progress.js';
import { Writable } from 'node:stream';

function createFakeStream(isTTY: boolean): { stream: NodeJS.WriteStream; output: () => string; clear: () => void } {
  let buf = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      buf += chunk.toString();
      callback();
    },
  }) as unknown as NodeJS.WriteStream;
  (stream as any).isTTY = isTTY;
  return { stream, output: () => buf, clear: () => { buf = ''; } };
}

describe('Progress', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('TTY mode', () => {
    it('start renders spinner frame and message', () => {
      const fake = createFakeStream(true);
      const p = new Progress(fake.stream);
      p.start('Loading...');
      expect(fake.output()).toContain('Loading...');
      p.succeed(); // cleanup timer
    });

    it('spinner animates on interval', () => {
      const fake = createFakeStream(true);
      const p = new Progress(fake.stream);
      p.start('Working...');
      fake.clear();
      vi.advanceTimersByTime(80);
      expect(fake.output()).toContain('Working...');
      p.succeed();
    });

    it('update changes message on next render', () => {
      const fake = createFakeStream(true);
      const p = new Progress(fake.stream);
      p.start('Step 1');
      p.update('Step 2');
      vi.advanceTimersByTime(80);
      expect(fake.output()).toContain('Step 2');
      p.succeed();
    });

    it('succeed stops spinner and shows green check', () => {
      const fake = createFakeStream(true);
      const p = new Progress(fake.stream);
      p.start('Working...');
      fake.clear();
      p.succeed('Done!');
      const out = fake.output();
      expect(out).toContain('Done!');
      expect(out).toContain('✓');
      expect(out.endsWith('\n')).toBe(true);
    });

    it('fail stops spinner and shows red cross', () => {
      const fake = createFakeStream(true);
      const p = new Progress(fake.stream);
      p.start('Working...');
      fake.clear();
      p.fail('Error!');
      const out = fake.output();
      expect(out).toContain('Error!');
      expect(out).toContain('✘');
      expect(out.endsWith('\n')).toBe(true);
    });

    it('succeed uses last message if none provided', () => {
      const fake = createFakeStream(true);
      const p = new Progress(fake.stream);
      p.start('Working...');
      fake.clear();
      p.succeed();
      expect(fake.output()).toContain('Working...');
    });

    it('fail uses last message if none provided', () => {
      const fake = createFakeStream(true);
      const p = new Progress(fake.stream);
      p.start('Working...');
      fake.clear();
      p.fail();
      expect(fake.output()).toContain('Working...');
    });
  });

  describe('non-TTY mode', () => {
    it('start writes plain line', () => {
      const fake = createFakeStream(false);
      const p = new Progress(fake.stream);
      p.start('Loading...');
      const out = fake.output();
      expect(out).toContain('- Loading...');
      expect(out.endsWith('\n')).toBe(true);
      p.succeed();
    });

    it('update writes plain line', () => {
      const fake = createFakeStream(false);
      const p = new Progress(fake.stream);
      p.update('Step 2...');
      expect(fake.output()).toContain('- Step 2...');
    });

    it('succeed writes check mark', () => {
      const fake = createFakeStream(false);
      const p = new Progress(fake.stream);
      p.succeed('Done!');
      const out = fake.output();
      expect(out).toContain('✓');
      expect(out).toContain('Done!');
    });

    it('fail writes cross mark', () => {
      const fake = createFakeStream(false);
      const p = new Progress(fake.stream);
      p.fail('Error!');
      const out = fake.output();
      expect(out).toContain('✘');
      expect(out).toContain('Error!');
    });
  });
});

describe('AnimatedStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts with first message', () => {
    const fake = createFakeStream(true);
    const p = new Progress(fake.stream);
    const status = new AnimatedStatus(['Msg 1', 'Msg 2', 'Msg 3'], p);
    status.start();
    expect(fake.output()).toContain('Msg 1');
    status.succeed('done');
  });

  it('cycles through messages on interval', () => {
    const fake = createFakeStream(true);
    const p = new Progress(fake.stream);
    const status = new AnimatedStatus(['Msg 1', 'Msg 2', 'Msg 3'], p);
    status.start();
    fake.clear();

    vi.advanceTimersByTime(3000);
    // After 3s, should have cycled to Msg 2
    // Advance a bit more for the spinner to render
    vi.advanceTimersByTime(100);
    expect(fake.output()).toContain('Msg 2');
    status.succeed('done');
  });

  it('pin overrides current message', () => {
    const fake = createFakeStream(true);
    const p = new Progress(fake.stream);
    const status = new AnimatedStatus(['Default'], p);
    status.start();
    status.pin('Reading server.ts...');
    vi.advanceTimersByTime(100);
    expect(fake.output()).toContain('Reading server.ts...');
    status.succeed('done');
  });

  it('succeed stops cycling and shows final message', () => {
    const fake = createFakeStream(true);
    const p = new Progress(fake.stream);
    const status = new AnimatedStatus(['Msg 1', 'Msg 2'], p);
    status.start();
    fake.clear();
    status.succeed('All done!');
    expect(fake.output()).toContain('All done!');
    expect(fake.output()).toContain('✓');
  });

  it('fail stops cycling and shows error', () => {
    const fake = createFakeStream(true);
    const p = new Progress(fake.stream);
    const status = new AnimatedStatus(['Msg 1'], p);
    status.start();
    fake.clear();
    status.fail('Failed!');
    expect(fake.output()).toContain('Failed!');
    expect(fake.output()).toContain('✘');
  });
});
