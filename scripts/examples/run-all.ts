const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
};

const scripts = [
  "01-collection-setup",
  "02-querying",
  "03-sections",
  "04-relationships",
  "05-document-api",
  "06-extract-sections",
  "07-validation",
  "08-serialization",
];

async function runAll() {
  console.log();
  console.log(
    `${c.cyan}${c.bold}  ╔══════════════════════════════════════╗${c.reset}`
  );
  console.log(
    `${c.cyan}${c.bold}  ║   Contentbase — Interactive Examples ║${c.reset}`
  );
  console.log(
    `${c.cyan}${c.bold}  ╚══════════════════════════════════════╝${c.reset}`
  );

  for (const script of scripts) {
    const mod = await import(`./${script}`);
    await mod.main();
  }

  console.log(
    `${c.green}${c.bold}  ✓ All ${scripts.length} example scripts completed.${c.reset}`
  );
  console.log();
}

runAll().catch(console.error);
