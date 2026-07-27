import assert from "node:assert/strict";
import test from "node:test";

import { sanitizedEnvironment, secretMinimizedEnvironment } from "../../../src/features/execution-authority";

test("inherits only execution essentials and never clones a secret-bearing host environment", () => {
  const environment = secretMinimizedEnvironment({
    host: {
      PATH: "/safe/bin",
      TMPDIR: "/safe/tmp",
      HOME: "/users/private",
      GH_TOKEN: "host-token",
      AWS_SECRET_ACCESS_KEY: "host-secret",
      NODE_OPTIONS: "--require=/unsafe/inject.js",
    },
    inherit: ["PATH", "TMPDIR"],
    explicit: { SERVICE_TOKEN: "needed-for-this-process", REGION: "test" },
    neutralHome: "/neutral",
  });

  assert.deepEqual(environment, {
    PATH: "/safe/bin",
    TMPDIR: "/safe/tmp",
    SERVICE_TOKEN: "needed-for-this-process",
    REGION: "test",
    HOME: "/neutral",
    USERPROFILE: "/neutral",
    XDG_CONFIG_HOME: "/neutral",
  });
  assert.equal(Object.hasOwn(environment, "GH_TOKEN"), false);
  assert.equal(Object.hasOwn(environment, "AWS_SECRET_ACCESS_KEY"), false);
  assert.equal(Object.hasOwn(environment, "NODE_OPTIONS"), false);
  assert.equal(Object.isFrozen(environment), true);
  assert.equal(sanitizedEnvironment(environment).SERVICE_TOKEN, "[redacted]");
});

test("rejects repository-controlled inheritance and process injection variables", () => {
  assert.throws(() => secretMinimizedEnvironment({ inherit: ["HOME"] }), /inheritance-prohibited:HOME/);
  assert.throws(() => secretMinimizedEnvironment({ explicit: { NODE_OPTIONS: "--inspect" } }), /variable-prohibited:NODE_OPTIONS/);
  assert.throws(() => secretMinimizedEnvironment({ explicit: { DYLD_INSERT_LIBRARIES: "/unsafe/lib" } }), /variable-prohibited:DYLD_INSERT_LIBRARIES/);
  assert.throws(() => secretMinimizedEnvironment({ explicit: { SAFE: "bad\0value" } }), /value-invalid:SAFE/);
  assert.doesNotThrow(() => secretMinimizedEnvironment({ fixed: { GIT_CONFIG_NOSYSTEM: "1" } }));
});
