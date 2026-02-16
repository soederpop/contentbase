// ANSI escape codes
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
};

export function scriptTitle(num: string, title: string) {
  const text = ` ${num}. ${title} `;
  const line = "═".repeat(text.length + 2);
  console.log();
  console.log(`${c.cyan}${c.bold}╔${line}╗${c.reset}`);
  console.log(`${c.cyan}${c.bold}║ ${text} ║${c.reset}`);
  console.log(`${c.cyan}${c.bold}╚${line}╝${c.reset}`);
  console.log();
}

interface DemoBlock {
  title: string;
  description?: string;
  code: string;
  run: () => unknown | Promise<unknown>;
}

export async function demo(block: DemoBlock) {
  // Title
  console.log(`  ${c.yellow}${c.bold}▸ ${block.title}${c.reset}`);

  // Description
  if (block.description) {
    console.log(`  ${c.dim}${block.description}${c.reset}`);
  }

  // Code box
  const codeLines = block.code.split("\n");
  const maxLen = Math.max(...codeLines.map((l) => l.length));
  const border = "─".repeat(maxLen + 2);

  console.log(`  ${c.dim}┌${border}┐${c.reset}`);
  for (const line of codeLines) {
    console.log(`  ${c.dim}│${c.reset} ${line.padEnd(maxLen)} ${c.dim}│${c.reset}`);
  }
  console.log(`  ${c.dim}└${border}┘${c.reset}`);

  // Run and display output
  const result = await block.run();

  if (result != null) {
    let output: string;
    if (typeof result === "string") {
      output = result;
    } else {
      output = JSON.stringify(result, null, 2);
    }

    const outLines = output.split("\n");
    const outMaxLen = Math.max(...outLines.map((l) => l.length));
    const outBorder = "─".repeat(outMaxLen + 2);

    console.log(`  ${c.green}┌${outBorder}┐${c.reset}`);
    for (const line of outLines) {
      console.log(`  ${c.green}│${c.reset} ${c.green}${line.padEnd(outMaxLen)}${c.reset} ${c.green}│${c.reset}`);
    }
    console.log(`  ${c.green}└${outBorder}┘${c.reset}`);
  }

  console.log();
}

export function kv(key: string, value: unknown): string {
  return `${c.magenta}${key}:${c.reset} ${value}`;
}

export function list(items: string[]): string {
  return items.map((item) => `  • ${item}`).join("\n");
}

export function heading(text: string) {
  console.log(`  ${c.cyan}${c.bold}${text}${c.reset}`);
  console.log();
}
