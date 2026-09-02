#!/usr/bin/env node
// P1.3 — Concatenate the self-heal library's load-order files into one script
// suitable for page.addInitScript(). Runs before Playwright starts a page.
//
// Load order derived from self-heal/README.md + IIFE-global inspection of each module.
// Any addition here should also update experiment/PLAN.md's load-order note.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LIB = path.resolve(__dirname, '..', 'lib');
const OUT = path.resolve(__dirname, '..', 'logs', 'selfheal-bundle.js');

const files = [
  'selfheal-core.js',                                // SELFHEAL
  'self-heal/schemas/false-heal.js',                 // SELFHEAL_FALSEHEAL
  'self-heal/schemas/flywheel-event.schema.js',      // SELFHEAL_SCHEMA_FLYWHEEL
  'self-heal/pipeline/candidate-generation.js',      // SELFHEAL_CANDGEN
  'self-heal/pipeline/change-diagnosis.js',          // SELFHEAL_DIAGNOSIS
  'self-heal/pipeline/candidate-validation.js',      // SELFHEAL_VALIDATE
  'self-heal/pipeline/failure-reporter.js',          // SELFHEAL_REPORTER
  'self-heal/pipeline/outcome-verification.js',      // SELFHEAL_VERIFY
  'self-heal/pipeline/temporal-wait.js',             // SELFHEAL_TEMPORALWAIT
  'self-heal/pipeline/search-and-pick.js',           // SELFHEAL_SEARCHPICK
  'self-heal/pipeline/learning-loop.js',             // SELFHEAL_LEARN
  'self-heal/brain/brain.js',                        // SELFHEAL_BRAIN
  'self-heal/pretotype/selfheal-runtime.js',         // __RUNTIME
];

function readOrFail(rel) {
  const abs = path.join(LIB, rel);
  if (!fs.existsSync(abs)) throw new Error(`bundle-library: missing ${rel} at ${abs}`);
  return `\n/* ==== ${rel} ==== */\n` + fs.readFileSync(abs, 'utf8');
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const bundle = files.map(readOrFail).join('\n;\n');
fs.writeFileSync(OUT, bundle);

const globals = ['SELFHEAL', 'SELFHEAL_FALSEHEAL', 'SELFHEAL_SCHEMA_FLYWHEEL', 'SELFHEAL_CANDGEN',
                 'SELFHEAL_DIAGNOSIS', 'SELFHEAL_VALIDATE', 'SELFHEAL_REPORTER', 'SELFHEAL_VERIFY',
                 'SELFHEAL_TEMPORALWAIT', 'SELFHEAL_SEARCHPICK', 'SELFHEAL_LEARN', 'SELFHEAL_BRAIN',
                 '__RUNTIME'];
console.log(`bundled ${files.length} files → ${path.relative(process.cwd(), OUT)} (${bundle.length} bytes)`);
console.log(`expected globals in page: ${globals.join(', ')}`);
