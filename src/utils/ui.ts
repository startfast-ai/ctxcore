// ── ctxcore CLI visual identity — Claude color palette ──

// Claude brand colors (truecolor)
export const CLAUDE_ORANGE = '\x1b[38;2;217;119;87m';     // #D97757 — primary brand
export const CLAUDE_CREAM = '\x1b[38;2;232;221;211m';     // #E8DDD3 — warm light
export const CLAUDE_DARK = '\x1b[38;2;26;25;21m';         // #1A1915 — near-black
export const CLAUDE_WARM = '\x1b[38;2;191;163;144m';      // #BFA390 — warm mid
export const CLAUDE_PEACH = '\x1b[38;2;235;178;153m';     // #EBB299 — soft accent
export const CLAUDE_RUST = '\x1b[38;2;176;89;62m';        // #B0593E — deep accent
export const CLAUDE_SAND = '\x1b[38;2;209;196;181m';      // #D1C4B5 — muted

// Background variants
export const BG_CLAUDE_ORANGE = '\x1b[48;2;217;119;87m\x1b[38;2;255;255;255m';
export const BG_CLAUDE_RUST = '\x1b[48;2;176;89;62m\x1b[38;2;255;255;255m';
export const BG_CLAUDE_WARM = '\x1b[48;2;191;163;144m\x1b[38;2;26;25;21m';
export const BG_CLAUDE_PEACH = '\x1b[48;2;235;178;153m\x1b[38;2;26;25;21m';

// Standard modifiers
export const DIM = '\x1b[90m';
export const BOLD = '\x1b[1m';
export const RESET = '\x1b[0m';

// Semantic aliases (mapped to Claude palette)
export const RED = '\x1b[38;2;204;82;62m';          // warm red
export const GREEN = '\x1b[38;2;139;166;126m';       // muted sage green
export const YELLOW = CLAUDE_ORANGE;                  // brand orange as accent
export const BLUE = '\x1b[38;2;140;150;170m';        // cool muted blue
export const MAGENTA = CLAUDE_RUST;                   // deep rust
export const CYAN = CLAUDE_ORANGE;                    // primary brand replaces cyan
export const WHITE = CLAUDE_CREAM;

// Background semantic aliases
export const BG_RED = '\x1b[48;2;204;82;62m\x1b[38;2;255;255;255m';
export const BG_GREEN = '\x1b[48;2;139;166;126m\x1b[38;2;26;25;21m';
export const BG_BLUE = '\x1b[48;2;140;150;170m\x1b[38;2;255;255;255m';
export const BG_MAGENTA = BG_CLAUDE_RUST;
export const BG_CYAN = BG_CLAUDE_ORANGE;

export function printLogo(): void {
  console.log();
  console.log(`  ${CLAUDE_ORANGE}${BOLD}  ██████╗████████╗██╗  ██╗ ██████╗ ██████╗ ██████╗ ███████╗${RESET}`);
  console.log(`  ${CLAUDE_ORANGE}${BOLD} ██╔════╝╚══██╔══╝╚██╗██╔╝██╔════╝██╔═══██╗██╔══██╗██╔════╝${RESET}`);
  console.log(`  ${CLAUDE_PEACH}${BOLD} ██║        ██║    ╚███╔╝ ██║     ██║   ██║██████╔╝█████╗${RESET}`);
  console.log(`  ${CLAUDE_PEACH}${BOLD} ██║        ██║    ██╔██╗ ██║     ██║   ██║██╔══██╗██╔══╝${RESET}`);
  console.log(`  ${CLAUDE_WARM}${BOLD} ╚██████╗   ██║   ██╔╝ ██╗╚██████╗╚██████╔╝██║  ██║███████╗${RESET}`);
  console.log(`  ${CLAUDE_WARM}${BOLD}  ╚═════╝   ╚═╝   ╚═╝  ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═╝╚══════╝${RESET}`);
  console.log(`  ${CLAUDE_SAND}  Persistent memory for Claude Code${RESET}`);
  console.log();
}

export function printHeader(title: string): void {
  const width = 48;
  const padded = title + ' '.repeat(Math.max(0, width - 4 - title.length));
  console.log();
  console.log(`  ${CLAUDE_ORANGE}${BOLD}╭${'─'.repeat(width)}╮${RESET}`);
  console.log(`  ${CLAUDE_ORANGE}${BOLD}│${RESET}  ${BOLD}${padded}${RESET}${CLAUDE_ORANGE}${BOLD}│${RESET}`);
  console.log(`  ${CLAUDE_ORANGE}${BOLD}╰${'─'.repeat(width)}╯${RESET}`);
  console.log();
}

export function printDivider(): void {
  console.log(`\n  ${CLAUDE_SAND}${'─'.repeat(48)}${RESET}\n`);
}

export function printKeyValue(key: string, value: string, indent = 2): void {
  const pad = ' '.repeat(indent);
  console.log(`${pad}${CLAUDE_WARM}${key.padEnd(14)}${RESET} ${value}`);
}

export function printSuccess(msg: string): void {
  console.log(`  ${GREEN}✓${RESET} ${msg}`);
}

export function printWarning(msg: string): void {
  console.log(`  ${CLAUDE_ORANGE}!${RESET} ${msg}`);
}

export function printError(msg: string): void {
  console.log(`  ${RED}✘${RESET} ${msg}`);
}

export function printInfo(msg: string): void {
  console.log(`  ${CLAUDE_PEACH}i${RESET} ${msg}`);
}

export function tierBadge(tier: string): string {
  switch (tier) {
    case 'long-term':   return `${BG_CLAUDE_RUST} LT ${RESET}`;
    case 'operational': return `${BG_CLAUDE_ORANGE} OP ${RESET}`;
    case 'short-term':  return `${BG_CLAUDE_WARM} ST ${RESET}`;
    default:            return `${DIM} ?? ${RESET}`;
  }
}

export function importanceBar(score: number): string {
  const filled = Math.round(score * 10);
  const blocks = `${CLAUDE_ORANGE}${'█'.repeat(filled)}${CLAUDE_SAND}${'░'.repeat(10 - filled)}${RESET}`;
  return blocks;
}

export function severityBadge(severity: string): string {
  switch (severity) {
    case 'critical': return `${BG_RED} CRIT ${RESET}`;
    case 'high':     return `${RED}${BOLD} HIGH ${RESET}`;
    case 'medium':   return `${CLAUDE_ORANGE} MED  ${RESET}`;
    case 'low':      return `${CLAUDE_PEACH} LOW  ${RESET}`;
    default:         return `${DIM} INFO ${RESET}`;
  }
}

export function printMemoryRow(content: string, tier: string, importance: number, maxWidth = 60): void {
  const badge = tierBadge(tier);
  const bar = importanceBar(importance);
  const text = content.length > maxWidth ? content.slice(0, maxWidth - 1) + '…' : content;
  console.log(`    ${badge} ${bar}  ${text}`);
}

export function printBox(lines: string[]): void {
  const maxLen = Math.max(...lines.map(l => stripAnsi(l).length));
  const width = Math.max(maxLen + 4, 40);

  console.log(`  ${CLAUDE_ORANGE}╭${'─'.repeat(width)}╮${RESET}`);
  for (const line of lines) {
    const visible = stripAnsi(line).length;
    const pad = ' '.repeat(Math.max(0, width - 2 - visible));
    console.log(`  ${CLAUDE_ORANGE}│${RESET} ${line}${pad} ${CLAUDE_ORANGE}│${RESET}`);
  }
  console.log(`  ${CLAUDE_ORANGE}╰${'─'.repeat(width)}╯${RESET}`);
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}
