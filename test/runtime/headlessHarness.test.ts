import assert from "node:assert/strict";
import test from "node:test";

import { createHeadlessRuntimeHarness } from "../../src/runtime/headlessHarness";

test("runs the shared application handler with replaceable ports", async () => {
  const expectedClock = { now: () => new Date("2026-07-25T00:00:00.000Z") };
  const expectedIdentity = { next: () => "test-id" };
  let observedName: string | undefined;

  const harness = createHeadlessRuntimeHarness({
    ports: { clock: expectedClock, identity: expectedIdentity },
    commandHandler: {
      async execute(request, ports) {
        observedName = request.name;
        assert.equal(ports.clock, expectedClock);
        assert.equal(ports.identity.next(), "test-id");
        return { status: "accepted", payload: { at: ports.clock.now().toISOString() } };
      },
    },
  });

  const result = await harness.execute({ name: "chat.session.create", payload: {} });

  assert.equal(observedName, "chat.session.create");
  assert.deepEqual(result, {
    status: "accepted",
    payload: { at: "2026-07-25T00:00:00.000Z" },
  });
});
