/**
 * Progress indicator for CLI operations.
 * Uses animated spinner with rotating frames in TTY mode,
 * falls back to sequential lines otherwise.
 */

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Progress {
  private message = '';
  private isTTY: boolean;
  private stream: NodeJS.WriteStream;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frameIndex = 0;

  constructor(stream?: NodeJS.WriteStream) {
    this.stream = stream ?? process.stderr;
    this.isTTY = this.stream.isTTY ?? false;
  }

  start(message: string): void {
    this.stop();
    this.message = message;
    this.frameIndex = 0;

    if (this.isTTY) {
      this.render();
      this.timer = setInterval(() => {
        this.frameIndex = (this.frameIndex + 1) % SPINNER_FRAMES.length;
        this.render();
      }, 80);
    } else {
      this.stream.write(`- ${message}\n`);
    }
  }

  update(message: string): void {
    this.message = message;
    if (!this.isTTY) {
      this.stream.write(`- ${message}\n`);
    }
    // TTY mode: next interval tick will pick up the new message
  }

  succeed(message?: string): void {
    this.stop();
    const text = message ?? this.message;
    if (this.isTTY) {
      this.clearLine();
      this.stream.write(`\x1b[38;2;139;166;126m✓\x1b[0m ${text}\n`);
    } else {
      this.stream.write(`✓ ${text}\n`);
    }
  }

  fail(message?: string): void {
    this.stop();
    const text = message ?? this.message;
    if (this.isTTY) {
      this.clearLine();
      this.stream.write(`\x1b[38;2;204;82;62m✘\x1b[0m ${text}\n`);
    } else {
      this.stream.write(`✘ ${text}\n`);
    }
  }

  private render(): void {
    const frame = SPINNER_FRAMES[this.frameIndex];
    this.clearLine();
    this.stream.write(`\x1b[38;2;217;119;87m${frame}\x1b[0m ${this.message}`);
  }

  private clearLine(): void {
    this.stream.write('\r\x1b[K');
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/**
 * Animated spinner that cycles through contextual status messages.
 * Use for long-running operations to keep the user engaged.
 */
export class AnimatedStatus {
  private progress: Progress;
  private messages: string[];
  private messageIndex = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(messages: string[], progress: Progress) {
    this.messages = messages;
    this.progress = progress;
  }

  start(): void {
    this.messageIndex = 0;
    this.progress.start(this.messages[0]);

    if (this.messages.length > 1) {
      this.timer = setInterval(() => {
        this.messageIndex = (this.messageIndex + 1) % this.messages.length;
        this.progress.update(this.messages[this.messageIndex]);
      }, 3000);
    }
  }

  /** Update with a specific message (e.g. current file being read) */
  pin(message: string): void {
    this.progress.update(message);
  }

  succeed(message: string): void {
    this.stop();
    this.progress.succeed(message);
  }

  fail(message: string): void {
    this.stop();
    this.progress.fail(message);
  }

  private stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
