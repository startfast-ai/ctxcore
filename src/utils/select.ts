/**
 * Interactive arrow-key selector for CLI menus.
 * Falls back to numeric input if not a TTY.
 */

interface SelectOption {
  label: string;
  value: string;
  hint?: string;
}

export function interactiveSelect(options: SelectOption[], defaultIndex: number = 0): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    // Fallback: return default
    return Promise.resolve(options[defaultIndex].value);
  }

  return new Promise((resolve) => {
    let selected = defaultIndex;
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    // Hide cursor
    stdout.write('\x1b[?25l');

    function render() {
      // Move up to clear previous render (except first time)
      if (rendered) {
        stdout.write(`\x1b[${options.length}A`);
      }

      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const isSelected = i === selected;
        const pointer = isSelected ? '\x1b[36m❯\x1b[0m' : ' ';
        const label = isSelected ? `\x1b[1m\x1b[36m${opt.label}\x1b[0m` : `\x1b[2m${opt.label}\x1b[0m`;
        const hint = opt.hint ? `  \x1b[2m${opt.hint}\x1b[0m` : '';

        // Clear line and write
        stdout.write(`\x1b[K    ${pointer} ${label}${hint}\n`);
      }
    }

    let rendered = false;
    render();
    rendered = true;

    function onData(data: string) {
      // Arrow up
      if (data === '\x1b[A' || data === 'k') {
        selected = (selected - 1 + options.length) % options.length;
        render();
        return;
      }

      // Arrow down
      if (data === '\x1b[B' || data === 'j') {
        selected = (selected + 1) % options.length;
        render();
        return;
      }

      // Enter
      if (data === '\r' || data === '\n') {
        cleanup();
        resolve(options[selected].value);
        return;
      }

      // Number keys 1-9
      const num = parseInt(data, 10);
      if (!isNaN(num) && num >= 1 && num <= options.length) {
        selected = num - 1;
        cleanup();
        resolve(options[selected].value);
        return;
      }

      // Ctrl+C / Escape — return default
      if (data === '\x03' || data === '\x1b') {
        cleanup();
        resolve(options[defaultIndex].value);
        return;
      }
    }

    function cleanup() {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      // Show cursor
      stdout.write('\x1b[?25h');
    }

    stdin.on('data', onData);
  });
}
