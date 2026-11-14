'use strict';
/* Tests for never-touch. No TV involved: every case runs against the shipped
 * never-touch.json and, for the typo guard, against copies of it with one
 * deliberate defect each. The require of never-touch.cjs below is itself an
 * assertion — the module throws rather than arm a list that fails its own
 * self-test. */
const test = require('node:test');
const assert = require('node:assert/strict');

const NT = require('./never-touch.cjs');
const DOC = require('./never-touch.json');

function clone() {
  return JSON.parse(JSON.stringify(DOC));
}

/* 1: the shipped list arms cleanly and passes its own self-test. */
test('the shipped never-touch.json passes its self-test', () => {
  const result = NT.selfTest(DOC);
  assert.deepEqual(result.problems, []);
  assert.equal(result.ok, true);
});

/* 2: each seeded rule refuses — every path listed for it, caught by it. */
test('every seeded rule refuses the paths listed for it', () => {
  assert.ok(NT.rules.length >= 10, 'the list is seeded, not empty');
  for (const rule of NT.rules) {
    const paths = DOC.selfTest.refused[rule.id];
    assert.ok(paths && paths.length, 'rule ' + rule.id + ' has self-test paths');
    for (const p of paths) {
      const r = NT.check(p);
      assert.equal(r.ok, false, p + ' must be refused');
      assert.equal(r.rule.id, rule.id, p + ' must be caught by ' + rule.id);
    }
  }
});

/* 3: the lanes the tools actually write stay open. */
test('a safe path passes, with no rule attached', () => {
  for (const p of DOC.selfTest.allowed) {
    const r = NT.check(p);
    assert.equal(r.ok, true, p + ' must pass (caught by: ' + (r.rule && r.rule.id) + ')');
    assert.equal(r.rule, null);
  }
  assert.deepEqual(NT.check('/var/local/alvidaa/native-home/state.json'),
    { ok: true, rule: null, path: '/var/local/alvidaa/native-home/state.json' });
});

/* 4: the glob matches raw partitions and nothing else. */
test('a glob matches partitions and not neighbouring devices', () => {
  for (const p of ['/dev/mmcblk0p20', '/dev/mmcblk1p5', '/dev/mmcblk0', '/dev/mmcblk']) {
    assert.equal(NT.check(p).rule.id, 'raw-emmc', p);
  }
  for (const p of ['/dev/ttyS0', '/dev/shm/scratch', '/dev/mmc']) {
    assert.equal(NT.check(p).ok, true, p + ' must pass');
  }
});

/* 5: prefix boundaries — the tree, not names that merely begin alike. */
test('prefix rules cover their tree exactly, not look-alike names', () => {
  assert.equal(NT.check('/APPS/channelA/hisenseUI/index.html').rule.id, 'engine-shell');
  assert.equal(NT.check('/APPS/channelA/operation-ui/apps/launcher/js/app.js').ok, true);
  assert.equal(NT.check('/opt/hisenseUI/startgui.sh').rule.id, 'rootfs-ro');
  assert.equal(NT.check('/optool').ok, true, "'/opt' must not catch '/optool'");
  assert.equal(NT.check('/OAD').rule.id, 'ota-staging');
  assert.equal(NT.check('/OAD2').ok, true, "'/OAD' must not catch '/OAD2'");
  assert.equal(NT.check('/var/local/oem2/state').ok, true);
});

/* 6: dot-dot and doubled slashes cannot walk past a rule. */
test('traversal still lands on the rule', () => {
  assert.equal(NT.check('/var/local/alvidaa/../../../OAD/eulaDppTemp').rule.id, 'ota-staging');
  // two levels up is only /var — and /var/OAD matches nothing, which is the
  // trap the self-test caught in the first seed of this file
  assert.equal(NT.check('/var/local/alvidaa/../../OAD/eulaDppTemp').ok, true);
  assert.equal(NT.check('//OAD/pkgs/download/pkg.ipk').rule.id, 'ota-staging');
  assert.equal(NT.check('/APPS/channelA/operation-ui/../hisenseUI/index.html').rule.id, 'engine-shell');
  assert.equal(NT.check('/var/local/alvidaa/../alvidaa/config.json').ok, true);
  assert.equal(NT.check('/OAD/').rule.id, 'ota-staging', 'a trailing slash drops');
});

/* 7: assertSafe refuses, and the message carries the rule's reason. */
test('assertSafe throws with the rule id and its reason in the message', () => {
  const rule = DOC.rules.find(r => r.id === 'factory-reset-trigger');
  assert.throws(() => NT.assertSafe('/var/tvservice/reset_working'), error => {
    assert.match(error.message, /^refusing: /);
    assert.match(error.message, /factory-reset-trigger/);
    assert.ok(error.message.includes(rule.reason), 'the reason must be in the message: ' + error.message);
    return true;
  });
  assert.doesNotThrow(() => NT.assertSafe('/var/local/alvidaa/config.json'));
});

/* 8: the typo guard — a rule that matches nothing in the self-test list. */
test('a typo in a rule match fails the self-test', () => {
  const doc = clone();
  doc.rules.find(r => r.id === 'ota-staging').match = '/OAD-staging-typo';
  const result = NT.selfTest(doc);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /ota-staging/.test(p)),
    JSON.stringify(result.problems));
});

test('a rule with no self-test path at all fails the self-test', () => {
  const doc = clone();
  delete doc.selfTest.refused['oem-staging'];
  assert.equal(NT.selfTest(doc).ok, false);
});

test('a self-test id naming no rule fails the self-test', () => {
  const doc = clone();
  doc.selfTest.refused['gone-rule'] = ['/somewhere'];
  const result = NT.selfTest(doc);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /no rule with this id/.test(p)));
});

/* 9: shadowing — a path caught by the wrong rule is an error, not a pass. */
test('a listed path caught by a different rule fails the self-test', () => {
  const doc = clone();
  // An overbroad rule placed first swallows the OEM tree, so oem-staging's
  // own listed path no longer resolves to oem-staging.
  doc.rules.unshift({
    id: 'grab-all-var-local', match: '/var/local', type: 'prefix',
    reason: 'a deliberately overbroad fixture rule for the shadowing test'
  });
  doc.selfTest.refused['grab-all-var-local'] = ['/var/local/oem/logos/acme.png'];
  const result = NT.selfTest(doc);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /oem-staging/.test(p) && /caught by rule/.test(p)),
    JSON.stringify(result.problems));
});

test('an allowed path that a rule catches fails the self-test', () => {
  const doc = clone();
  doc.selfTest.allowed.push('/OAD/pkgs/download/pkg.ipk');
  const result = NT.selfTest(doc);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some(p => /is caught by rule/.test(p)));
});

/* 10: structural defects are caught before the match logic runs. */
test('unknown types, duplicate ids and stub reasons fail the self-test', () => {
  let doc = clone();
  doc.rules.find(r => r.id === 'raw-emmc').type = 'regex';
  assert.equal(NT.selfTest(doc).ok, false);

  doc = clone();
  doc.rules.push(JSON.parse(JSON.stringify(doc.rules[0])));
  assert.ok(NT.selfTest(doc).problems.some(p => /duplicate id/.test(p)));

  doc = clone();
  doc.rules.find(r => r.id === 'system-vendor').reason = 'short';
  assert.ok(NT.selfTest(doc).problems.some(p => /system-vendor/.test(p)));
});
