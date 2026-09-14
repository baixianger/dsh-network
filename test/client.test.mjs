import assert from "node:assert/strict";
import test from "node:test";

test("client loader mounts localized settings and owns both slot contributions", async () => {
  let plugin; const effects = []; const slots = []; let dictionaries;
  globalThis.window = { __ModuleLoader__: { load(entry) { plugin = entry.factory(() => ({ createElement: (type, props) => ({ type, props }) })); } } };
  try { await import(`../lib/client.js?test=${Date.now()}`); }
  finally { delete globalThis.window; }
  plugin.apply({
    locale: { bind: () => (key) => dictionaries.en[key], register(_ns, values) { dictionaries = values; return () => {}; } },
    effect(fn) { effects.push(fn()); },
    slots: { inject(_name, mount) { mount(); return () => {}; }, register(options, component) { slots.push({ options, component }); } }
  });
  assert.equal(slots.length, 2);
  assert.equal(slots[0].options.label(), "Open in DSH App");
  assert.equal(slots[1].options.label(), "Network");
  assert.equal(dictionaries.zh.pairDevice, "配对设备");
  assert.equal(effects.length, 4);
  for (const dispose of effects) dispose?.();
});
