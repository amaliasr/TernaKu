import test from "node:test";
import assert from "node:assert/strict";
import { BackStack, LAYER_KEY } from "../src/lib/back-stack";

function browser() {
  const entries = [
    {
      state: { nextRouter: true } as Record<string, unknown>,
      hash: "#employee-home",
    },
  ];
  let index = 0;
  let queued = 0;
  const stack = new BackStack({
    state: () => entries[index].state,
    hash: () => entries[index].hash,
    push: (state, hash) => {
      const previous = entries[index].hash;
      entries.splice(index + 1);
      entries.push({ state, hash: hash ?? previous });
      index++;
    },
    replace: (state) => {
      entries[index].state = state;
    },
    go: (delta) => {
      queued += delta;
    },
    changed: () => {},
  });
  return {
    stack,
    entries,
    current: () => entries[index],
    back: (steps = 1) => {
      index -= steps;
      assert.ok(index >= 0, "must stay inside the app");
      stack.pop();
    },
    forward: () => {
      index++;
      stack.pop();
    },
    flush: () => {
      let remaining = 20;
      while (queued) {
        assert.ok(remaining-- > 0, "history cleanup must finish");
        index += queued;
        queued = 0;
        assert.ok(index >= 0, "must stay inside the app");
        stack.pop();
      }
    },
  };
}

test("Android Back walks through visited menus to the initial home entry", () => {
  const b = browser();
  b.stack.navigate("#employee-production");
  b.stack.navigate("#employee-stock");
  b.back();
  assert.equal(b.current().hash, "#employee-production");
  b.back();
  assert.equal(b.current().hash, "#employee-home");
  assert.equal(b.current().state.nextRouter, true);
});
test("Back closes photo preview before the underlying form, then returns to its menu", () => {
  const b = browser();
  const closed: string[] = [];
  b.stack.navigate("#employee-sales");
  const form = b.stack.open(() => {
    closed.push("form");
    form();
  });
  const photo = b.stack.open(() => {
    closed.push("photo");
    photo();
  });
  b.back();
  assert.deepEqual(closed, ["photo"]);
  b.back();
  assert.deepEqual(closed, ["photo", "form"]);
  assert.equal(b.current().hash, "#employee-sales");
  b.back();
  assert.equal(b.current().hash, "#employee-home");
});
test("closing a form with its button removes its history entry without an extra Back", () => {
  const b = browser();
  b.stack.navigate("#employee-sales");
  const release = b.stack.open(() => assert.fail("already closed"));
  release();
  b.flush();
  assert.equal(b.current().state[LAYER_KEY], undefined);
  b.back();
  assert.equal(b.current().hash, "#employee-home");
});
test("choosing a menu from an open panel removes panel history before navigation", () => {
  const b = browser();
  let closed = 0;
  const release = b.stack.open(() => {
    closed++;
    release();
  });
  b.stack.navigate("#stock");
  b.flush();
  assert.equal(closed, 1);
  assert.equal(b.current().hash, "#stock");
  b.back();
  assert.equal(b.current().hash, "#employee-home");
});
test("opening another view while a close is pending waits for Back to finish", () => {
  const b = browser();
  let closed = 0;
  const first = b.stack.open(() => {});
  first();
  const second = b.stack.open(() => {
    closed++;
    second();
  });
  b.flush();
  assert.ok(b.current().state[LAYER_KEY]);
  b.back();
  assert.equal(closed, 1);
});
test("a cancelled pending view never opens and forward does not reopen discarded forms", () => {
  const b = browser();
  let closed = 0;
  const first = b.stack.open(() => { closed++; });
  first();
  const second = b.stack.open(() => { closed++; });
  second();
  b.flush();
  assert.equal(b.current().state[LAYER_KEY], undefined);
  b.forward();
  b.flush();
  assert.equal(b.current().state[LAYER_KEY], undefined);
  assert.equal(closed, 0);
});

test("Back rejected during a save preserves the form and its next Back entry", () => {
  const b = browser();
  let busy = true;
  let closed = 0;
  b.stack.navigate("#employee-sales");
  b.stack.open(() => {
    if (busy) return false;
    closed++;
  });
  const formId = b.current().state[LAYER_KEY];
  b.back();
  assert.equal(closed, 0);
  assert.equal(b.current().state[LAYER_KEY], formId);
  busy = false;
  b.back();
  assert.equal(closed, 1);
  assert.equal(b.current().hash, "#employee-sales");
  b.back();
  assert.equal(b.current().hash, "#employee-home");
});

test("cancelling a warning keeps nested forms in the original menu", () => {
  const b = browser();
  let accepted = false;
  let parentClosed = 0;
  b.stack.navigate("#employee-sales");
  b.stack.open(() => {
    parentClosed++;
  });
  b.stack.open(() => accepted);
  const childId = b.current().state[LAYER_KEY];
  b.back();
  assert.equal(b.current().state[LAYER_KEY], childId);
  assert.equal(parentClosed, 0);
  accepted = true;
  b.back();
  assert.equal(parentClosed, 0);
  b.back();
  assert.equal(parentClosed, 1);
});

test("unmounting a form and its photo removes all abandoned history entries", () => {
  for (const parentFirst of [true, false]) {
    const b = browser();
    b.stack.navigate("#employee-sales");
    const form = b.stack.open(() => assert.fail("already unmounted"));
    const photo = b.stack.open(() => assert.fail("already unmounted"));
    if (parentFirst) {
      form();
      photo();
    } else {
      photo();
      form();
    }
    b.flush();
    assert.equal(b.current().state[LAYER_KEY], undefined);
    assert.equal(b.current().hash, "#employee-sales");
    b.back();
    assert.equal(b.current().hash, "#employee-home");
  }
});

test("Back skips an unmounted ancestor without closing an unrelated page", () => {
  const b = browser();
  b.stack.navigate("#employee-sales");
  let childClosed = 0;
  const form = b.stack.open(() => assert.fail("already unmounted"));
  b.stack.open(() => {
    childClosed++;
  });
  form();
  b.back();
  b.flush();
  assert.equal(childClosed, 1);
  assert.equal(b.current().hash, "#employee-sales");
  assert.equal(b.current().state[LAYER_KEY], undefined);
  b.back();
  assert.equal(b.current().hash, "#employee-home");
});

test("Forward into a closed photo preserves the still-open parent form", () => {
  const b = browser();
  let parentClosed = 0;
  const parent = b.stack.open(() => {
    parentClosed++;
  });
  const parentId = b.current().state[LAYER_KEY];
  const photo = b.stack.open(() => {});
  photo();
  b.flush();
  b.forward();
  b.flush();
  assert.equal(parentClosed, 0);
  assert.equal(b.current().state[LAYER_KEY], parentId);
  parent();
  b.flush();
});

test("menu navigation cannot bypass a busy form or a cancelled warning", () => {
  const b = browser();
  let busy = true;
  let childClosed = 0;
  b.stack.open(() => !busy);
  const formId = b.current().state[LAYER_KEY];
  b.stack.open(() => {
    childClosed++;
  });
  b.stack.navigate("#stock");
  b.flush();
  assert.equal(childClosed, 1);
  assert.equal(b.current().state[LAYER_KEY], formId);
  assert.equal(b.current().hash, "#employee-home");
  busy = false;
  b.stack.navigate("#stock");
  b.flush();
  assert.equal(b.current().hash, "#stock");
  b.back();
  assert.equal(b.current().hash, "#employee-home");
});

test("a rejected history jump restores the form's menu and nested history", () => {
  const b = browser();
  let busy = true;
  let parentClosed = 0;
  b.stack.navigate("#employee-sales");
  b.stack.open(() => {
    parentClosed++;
  });
  b.stack.open(() => !busy);
  b.back(3);
  assert.equal(parentClosed, 0);
  assert.equal(b.current().hash, "#employee-sales");
  busy = false;
  b.back();
  assert.equal(parentClosed, 0);
  b.back();
  assert.equal(parentClosed, 1);
  assert.equal(b.current().hash, "#employee-sales");
  assert.equal(b.current().state[LAYER_KEY], undefined);
  b.back();
  assert.equal(b.current().hash, "#employee-home");
});

test("a queued menu change still checks the underlying busy form", () => {
  const b = browser(); let busy = true;
  b.stack.open(() => !busy);
  const formId = b.current().state[LAYER_KEY];
  const photo = b.stack.open(() => {});
  photo(); b.stack.navigate("#stock"); b.flush();
  assert.equal(b.current().state[LAYER_KEY], formId);
  assert.equal(b.current().hash, "#employee-home");
  busy = false; b.stack.navigate("#stock"); b.flush();
  assert.equal(b.current().hash, "#stock");
});
