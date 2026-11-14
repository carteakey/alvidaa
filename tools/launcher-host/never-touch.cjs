'use strict';
/* never-touch — the AGENTS.md hard rules as data, and a guard that refuses
 * against them (issue #53).
 *
 *   const neverTouch = require('./never-touch.cjs');
 *   neverTouch.check(path)      -> { ok, rule, path }   (rule is null when safe)
 *   neverTouch.assertSafe(path) -> throws unless safe; the message carries the rule's reason
 *   neverTouch.selfTest(doc)    -> { ok, problems }     (the typo guard, pure)
 *   neverTouch.rules            -> the seeded rule list
 *
 * Why: "never write to read-only partitions, never touch /OAD staging,
 * verified boot stays green" lived in prose, so they bound whoever read
 * AGENTS.md most recently. The same rules machine-checked bind every session
 * and every script: a write lane calls assertSafe() before it touches the TV,
 * and the refusal names the rule and its reason. Every match is a refusal —
 * there is no warning mode, because a protection that sometimes warns is a
 * warning.
 *
 * Sources: the AGENTS.md ground rules; the privilege map and eMMC layout in
 * docs/models/50A51HUV/09.01O.P0813/findings/04 and 07; the lane-3 handoff
 * (docs/project/HANDOFF-2026-11-09-LANE3.md). The stock bundle itself is
 * deliberately absent from the list — replacing it is the installer's whole
 * job, gated structurally (bootstrap pins the stock md5/sha256 and takes the
 * once-only backup before any write), so a path rule would refuse the one
 * legitimate write.
 *
 * Typo guard: never-touch.json carries a selfTest block. Every rule must
 * catch the paths listed under its own id, and every listed allowed path must
 * pass. A rule that matches nothing in the list is dead weight or a typo —
 * either way the module throws at require time, because a protection that
 * silently stops protecting is worse than none.
 *
 * Semantics: paths are TV-side and absolute. check() collapses a doubled
 * leading slash and runs path.posix.normalize() first, so dot-dot cannot walk
 * past a rule (/var/local/alvidaa/../../OAD lands on /OAD) and a trailing
 * slash drops. Relative input stays relative and can therefore never match a
 * rule; callers pass absolute TV paths. Rules apply in listed order and the
 * first hit wins. exact: the whole path. prefix: the path itself or anything
 * under it ('/opt' does not catch '/optool'). glob: '*' matches any run of
 * characters except '/'.
 *
 * Wiring: the two write-lane consumers (native-install.cjs, native-home.cjs)
 * do not call this yet — the call sites they should use:
 *   native-install.cjs — assertSafe(remote) at the top of upload(); the
 *   model profile's app/state in model(); syncWatcher's stage().
 *   native-home.cjs — every m.files[].file and m.caches[].file in perform()
 *   before the change runs; one loop covers install, update and restore,
 *   since all three dispatch through it.
 */
const fs = require('node:fs');
const path = require('node:path');

const TYPES = ['exact', 'prefix', 'glob'];

// '*' matches any run of characters except '/'; everything else is literal.
function globToRegExp(pattern) {
  const source = pattern.split('*')
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp('^' + source + '$');
}

// Prefix: the base path itself or anything under it — never a name that only
// begins with the same characters.
function prefixMatcher(base) {
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  return p => p === b || p.startsWith(b + '/');
}

function compile(rule) {
  switch (rule.type) {
    case 'exact': return p => p === rule.match;
    case 'prefix': return prefixMatcher(rule.match);
    case 'glob': { const re = globToRegExp(rule.match); return p => re.test(p); }
    default: throw new Error('never-touch: rule ' + rule.id + ' has unknown type ' + rule.type);
  }
}

// TV-absolute, lexically normalized. posix keeps a doubled leading slash
// ('//OAD'), which would slip past a prefix rule, so it collapses first.
function normalize(input) {
  let p = String(input);
  if (!p) return p;
  if (p.startsWith('/')) p = p.replace(/^\/{2,}/, '/');
  return path.posix.normalize(p);
}

function firstMatch(compiled, p) {
  for (const c of compiled) if (c.match(p)) return c;
  return null;
}

function structuralProblems(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['the document is not a JSON object'];
  }
  if (!Array.isArray(doc.rules) || doc.rules.length === 0) {
    return ['rules must be a non-empty array'];
  }
  const problems = [];
  const ids = new Set();
  doc.rules.forEach((rule, i) => {
    const at = 'rule ' + i;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
      problems.push(at + ': not an object');
      return;
    }
    if (typeof rule.id !== 'string' || !/^[a-z0-9-]+$/.test(rule.id)) {
      problems.push(at + ': id must be a lowercase-dashed string, got ' + JSON.stringify(rule.id));
    } else if (ids.has(rule.id)) {
      problems.push(at + ': duplicate id ' + rule.id);
    } else {
      ids.add(rule.id);
    }
    if (!TYPES.includes(rule.type)) {
      problems.push(at + ' (' + rule.id + '): type must be one of ' + TYPES.join(', ') +
        ', got ' + JSON.stringify(rule.type));
    }
    if (typeof rule.match !== 'string' || !rule.match) {
      problems.push(at + ' (' + rule.id + '): match must be a non-empty string');
    }
    if (typeof rule.reason !== 'string' || rule.reason.trim().length < 20) {
      problems.push(at + ' (' + rule.id + '): reason must be a real sentence — the refusal carries it');
    }
  });
  return problems;
}

// The typo guard proper. Every rule must catch the paths listed under its own
// id (as the first match — shadowing by an earlier rule is reported), and
// every allowed path must pass.
function selfTestProblems(doc) {
  const problems = structuralProblems(doc);
  if (problems.length) return problems;

  const compiled = doc.rules.map(rule => ({ rule, match: compile(rule) }));
  const st = (doc.selfTest && typeof doc.selfTest === 'object' && !Array.isArray(doc.selfTest))
    ? doc.selfTest : {};
  const refused = (st.refused && typeof st.refused === 'object' && !Array.isArray(st.refused))
    ? st.refused : {};
  if (!st.refused) {
    problems.push('selfTest.refused is missing — every rule must list at least one path it must catch');
  }
  const allowed = Array.isArray(st.allowed) ? st.allowed : [];
  if (st.allowed && !Array.isArray(st.allowed)) {
    problems.push('selfTest.allowed must be an array');
  }

  for (const id of Object.keys(refused)) {
    if (!compiled.some(c => c.rule.id === id)) {
      problems.push('selfTest.refused[' + id + ']: no rule with this id');
    }
  }
  for (const c of compiled) {
    const paths = refused[c.rule.id];
    if (!Array.isArray(paths) || paths.length === 0) {
      problems.push('rule ' + c.rule.id + ': no path in selfTest.refused — a protection that matches ' +
        'nothing in the self-test list is dead weight or a typo');
      continue;
    }
    for (const raw of paths) {
      const hit = firstMatch(compiled, normalize(raw));
      if (!hit) {
        problems.push('selfTest.refused[' + c.rule.id + '] ' + raw + ': matches nothing — the rule never fires');
      } else if (hit.rule.id !== c.rule.id) {
        problems.push('selfTest.refused[' + c.rule.id + '] ' + raw + ': is caught by rule ' +
          hit.rule.id + ' instead (shadowed or mis-keyed)');
      }
    }
  }
  for (const raw of allowed) {
    const hit = firstMatch(compiled, normalize(raw));
    if (hit) {
      problems.push('selfTest.allowed ' + raw + ': is caught by rule ' + hit.rule.id +
        ' — remove it from the list or fix the rule');
    }
  }
  return problems;
}

// Pure: run the typo guard over any never-touch document.
function selfTest(doc) {
  const problems = selfTestProblems(doc);
  return { ok: problems.length === 0, problems };
}

// Load and arm. A list that fails its own self-test refuses to arm: the throw
// is the typo guard, not an error path.
function load() {
  const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'never-touch.json'), 'utf8'));
  const { problems } = selfTest(doc);
  if (problems.length) {
    throw new Error('never-touch.json failed its self-test — refusing to arm a broken guard:\n  ' +
      problems.join('\n  '));
  }
  return doc;
}

const DOC = load();
const COMPILED = DOC.rules.map(rule => ({ rule, match: compile(rule) }));

function check(input) {
  const p = normalize(input);
  const hit = firstMatch(COMPILED, p);
  return hit ? { ok: false, rule: hit.rule, path: p } : { ok: true, rule: null, path: p };
}

function assertSafe(input) {
  const result = check(input);
  if (!result.ok) {
    throw new Error('refusing: ' + result.path + ' is on the never-touch list [' + result.rule.id + '] — ' +
      result.rule.reason + ' (never-touch.json)');
  }
  return result.path;
}

module.exports = { check, assertSafe, selfTest, normalize, rules: DOC.rules };
