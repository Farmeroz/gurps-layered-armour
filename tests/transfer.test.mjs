import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { ID, newLayer, validateProfile } from '../scripts/core.mjs';
import {
  exportSetup,
  importSetup,
  unmatchedLocations,
  setupFilename,
  downloadSetup,
  MAX_TRANSFER_BYTES,
} from '../scripts/transfer.mjs';
const setup = () => ({
  schema: 1,
  enabled: true,
  layers: [
    { ...newLayer(['Torso']), name: 'Outer plate', dr: 12, hardened: 2, split: { cr: 0, cut: 8 } },
    {
      ...newLayer(['Torso']),
      name: 'Inner suit',
      dr: 6,
      enabled: false,
      flexible: true,
      allLocations: true,
      locations: [
        { where: 'Torso', dr: null, split: { 'pi+': 0 } },
        { where: 'Tail', dr: 3, split: { cut: 1 } },
      ],
    },
  ],
});
test('portable JSON round-trip preserves every armour field and removes actor-specific extras', () => {
  const p = setup();
  p.actor = 'Actor.source';
  p.world = 'source-world';
  p.layers[0].itemUuid = 'Item.source';
  const text = exportSetup(p),
    copy = importSetup(text);
  assert.deepEqual(copy, validateProfile(p));
  assert.doesNotMatch(text, /Actor.source|source-world|Item.source/);
  assert.equal(JSON.parse(text).format, ID);
  assert.equal(JSON.parse(text).version, 2);
  copy.layers[0].dr = 99;
  assert.equal(p.layers[0].dr, 12);
  assert.deepEqual(importSetup('\uFEFF' + text), validateProfile(p));
});
test('malformed, unrelated and future JSON is rejected with useful errors', () => {
  for (const text of ['{', 'not JSON']) assert.throws(() => importSetup(text), /valid JSON/);
  for (const value of [null, [], {}, { format: 'other', version: 1, profile: setup() }])
    assert.throws(() => importSetup(JSON.stringify(value)), /exported by/);
  assert.throws(
    () => importSetup(JSON.stringify({ format: ID, version: 3, profile: setup() })),
    /version/,
  );
  const p = setup();
  p.schema = 2;
  assert.throws(
    () => importSetup(JSON.stringify({ format: ID, version: 1, profile: p })),
    /version/,
  );
  assert.throws(() => importSetup(' '.repeat(MAX_TRANSFER_BYTES + 1)), /16 MiB/);
});
test('file validation rejects string toggles, coerced DR and out-of-range layer values', () => {
  for (const patch of [
    { enabled: 'false' },
    { dr: false },
    { dr: '12' },
    { dr: -1 },
    { hardened: 7 },
    { split: { cr: '0' } },
    { locations: [null] },
  ]) {
    const p = setup();
    Object.assign(p.layers[0], patch);
    assert.throws(() => importSetup(JSON.stringify({ format: ID, version: 1, profile: p })));
  }
  const p = setup();
  p.layers.push(null);
  assert.throws(() => exportSetup(p), /Invalid layer/);
});
test('unknown locations are reported exactly and safe filenames do not carry paths', () => {
  assert.deepEqual(unmatchedLocations(setup(), ['Torso', 'Skull']), ['Tail']);
  assert.equal(setupFilename('../Jo: *test*'), 'jo-test-armour-layers.json');
  assert.equal(setupFilename(''), 'actor-armour-layers.json');
});
test('download uses a JSON Blob and cleans up the temporary link and URL', async () => {
  let payload,
    clicked = false,
    removed = false,
    cleanup,
    revoked;
  const anchor = {
    addEventListener() {},
    click() {
      clicked = true;
    },
    remove() {
      removed = true;
    },
  };
  const doc = {
    defaultView: {
      Blob,
      URL: {
        createObjectURL(blob) {
          payload = blob;
          return 'blob:test';
        },
        revokeObjectURL(url) {
          revoked = url;
        },
      },
      setTimeout(fn) {
        cleanup = fn;
      },
    },
    createElement: () => anchor,
    body: {
      append(node) {
        assert.equal(node, anchor);
      },
    },
  };
  const text = exportSetup(setup());
  downloadSetup(text, 'jo-armour-layers.json', doc);
  assert.equal(clicked, true);
  assert.equal(removed, true);
  assert.equal(anchor.download, 'jo-armour-layers.json');
  assert.equal(payload.type, 'application/json;charset=utf-8');
  assert.equal(await payload.text(), text);
  cleanup();
  assert.equal(revoked, 'blob:test');
});

test('export delegates exact JSON and filename to Foundry without creating a page link', () => {
  const previous = globalThis.foundry;
  const calls = [];
  globalThis.foundry = { utils: { saveDataToFile: (...args) => calls.push(args) } };
  try {
    const text = exportSetup(setup());
    downloadSetup(text, 'combat-armour-layers.json', {
      createElement() {
        assert.fail('Native export must not create a page link.');
      },
    });
    assert.deepEqual(calls, [[text, 'application/json', 'combat-armour-layers.json']]);
  } finally {
    globalThis.foundry = previous;
  }
});

test('fallback download does not reach delegated link handlers or cancel the download action', () => {
  const { document, window } = parseHTML('<html><body></body></html>');
  let navigations = 0,
    link,
    cancelled,
    cleanup;
  document.body.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      navigations++;
      event.preventDefault();
    }
  });
  const facade = {
    defaultView: {
      Blob,
      URL: { createObjectURL: () => 'blob:armour', revokeObjectURL() {} },
      setTimeout: (fn) => {
        cleanup = fn;
      },
    },
    body: document.body,
    createElement() {
      link = document.createElement('a');
      link.click = () => {
        const event = new window.Event('click', { bubbles: true, cancelable: true });
        link.dispatchEvent(event);
        cancelled = event.defaultPrevented;
      };
      return link;
    },
  };
  downloadSetup(exportSetup(setup()), 'combat.json', facade);
  assert.equal(navigations, 0);
  assert.equal(cancelled, false);
  assert.equal(link.download, 'combat.json');
  assert.equal(link.target, '_self');
  assert.equal(link.isConnected, false);
  cleanup();
});
