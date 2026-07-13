const assert = require("node:assert/strict");
const test = require("node:test");
const { GATE_SCRIPT, spawnGatedPty } = require("../electron/pty-launch.cjs");

function fixture(overrides = {}) {
  const order = [];
  const callbacks = {};
  const processPty = {
    onData(callback) { order.push("listen:data"); callbacks.data = callback; },
    onExit(callback) { order.push("listen:exit"); callbacks.exit = callback; },
    kill() { order.push("kill"); },
  };
  const pty = {
    spawn(command, args, options) {
      order.push("spawn");
      callbacks.spawn = { command, args, options };
      return processPty;
    },
  };
  const fileSystem = {
    writeFileSync(file, content, options) {
      order.push("release");
      callbacks.release = { file, content, options };
      overrides.onRelease?.(callbacks);
    },
    rmSync() { order.push("cleanup"); },
    ...overrides.fileSystem,
  };
  return { order, callbacks, processPty, pty, fileSystem };
}

test("anexa listeners de dados e saída antes de liberar a CLI real", () => {
  const value = fixture();
  const events = [];
  const result = spawnGatedPty({
    pty: value.pty,
    executable: "/usr/bin/opencode",
    args: [".", "--mini", "--no-replay"],
    spawnOptions: { cwd: "/workspace" },
    gateDirectory: "/workspace/.korda-runtime-test",
    onSpawn: (processPty) => {
      assert.equal(processPty, value.processPty);
      value.order.push("registered");
    },
    onData: (data) => events.push(["data", data]),
    onExit: (event) => events.push(["exit", event.exitCode]),
  }, {
    fs: value.fileSystem,
    randomUUID: () => "abc-123",
  });

  assert.deepEqual(value.order, ["spawn", "registered", "listen:data", "listen:exit", "release"]);
  assert.equal(result.processPty, value.processPty);
  assert.equal(result.gatePath, "/workspace/.korda-runtime-test/.pty-gate-abc-123");
  assert.deepEqual(value.callbacks.spawn, {
    command: "/bin/sh",
    args: ["-c", GATE_SCRIPT, "korda-pty-gate", result.gatePath, "/usr/bin/opencode", ".", "--mini", "--no-replay"],
    options: { cwd: "/workspace" },
  });
  assert.deepEqual(value.callbacks.release.options, { encoding: "utf8", mode: 0o600, flag: "wx" });
  assert.deepEqual(events, []);
});

test("captura primeiros bytes e early-exit ocorridos no instante da liberação", () => {
  const events = [];
  const value = fixture({
    onRelease(callbacks) {
      callbacks.data("primeiro-frame");
      callbacks.exit({ exitCode: 7 });
    },
  });

  spawnGatedPty({
    pty: value.pty,
    executable: "/usr/bin/opencode",
    spawnOptions: {},
    gateDirectory: "/workspace/.korda-runtime-test",
    onSpawn() {},
    onData: (data) => events.push(["data", data]),
    onExit: ({ exitCode }) => events.push(["exit", exitCode]),
  }, { fs: value.fileSystem, randomUUID: () => "fast" });

  assert.deepEqual(events, [["data", "primeiro-frame"], ["exit", 7]]);
});

test("mata o wrapper e remove o gate se a liberação falhar", () => {
  const value = fixture({
    fileSystem: {
      writeFileSync() { value.order.push("release:error"); throw new Error("sem espaço"); },
      rmSync() { value.order.push("cleanup"); },
    },
  });

  assert.throws(() => spawnGatedPty({
    pty: value.pty,
    executable: "/usr/bin/opencode",
    spawnOptions: {},
    gateDirectory: "/workspace/.korda-runtime-test",
    onSpawn() { value.order.push("registered"); },
    onData() {},
    onExit() {},
  }, { fs: value.fileSystem, randomUUID: () => "failure" }), /sem espaço/);

  assert.deepEqual(value.order, ["spawn", "registered", "listen:data", "listen:exit", "release:error", "cleanup", "kill"]);
});
