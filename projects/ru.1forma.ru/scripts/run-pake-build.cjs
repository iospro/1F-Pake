#!/usr/bin/env node

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const pakeCliRoot = path.resolve(projectRoot, "..", "..");
const config = require(path.join(__dirname, "pake-build-config.json"));

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    const next = argv[i + 1];
    switch (arg) {
      case "--url":
      case "--name":
      case "--title":
      case "--targets":
      case "--width":
      case "--height":
        if (next && !next.startsWith("--")) {
          options[arg.slice(2)] = next;
          i += 1;
        }
        break;
      default:
        break;
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const cliPath = path.join(pakeCliRoot, "dist", "cli.js");
const args = [
  options.url || config.url,
  "--width",
  String(options.width || config.width),
  "--height",
  String(options.height || config.height),
];

if (config.hideTitleBar) {
  args.push("--hide-title-bar");
}

for (const flag of config.sharedFlags || []) {
  args.push(flag);
}

if (options.name) {
  args.push("--name", options.name);
}

if (options.title) {
  args.push("--title", options.title);
}

if (options.targets) {
  args.push("--targets", options.targets);
}

for (const inject of config.inject || []) {
  args.push("--inject", path.join(pakeCliRoot, inject));
}

const result = spawnSync(process.execPath, [cliPath, ...args], {
  cwd: pakeCliRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    PAKE_CREATE_APP: process.env.PAKE_CREATE_APP || "1",
  },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
