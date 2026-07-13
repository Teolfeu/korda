function createTerminalMetrics({ id, command, cwd, cols, rows }, now = Date.now()) {
  return {
    id,
    command,
    cwd,
    cols,
    rows,
    createdAt: now,
    lastActivityAt: now,
    bytesIn: 0,
    bytesOut: 0,
    inputEvents: 0,
    exited: false,
    closed: false,
    exitCode: null,
  };
}

function recordTerminalIo(metrics, direction, data, now = Date.now()) {
  if (direction !== "in" && direction !== "out") throw new TypeError("Direção de telemetria inválida.");
  metrics[direction === "in" ? "bytesIn" : "bytesOut"] += Buffer.byteLength(data, "utf8");
  if (direction === "in") metrics.inputEvents += 1;
  metrics.lastActivityAt = now;
}

function snapshotTerminalMetrics(items, now = Date.now()) {
  const terminals = Array.from(items, (item) => ({
    id: item.id,
    command: item.command,
    cwd: item.cwd,
    cols: item.cols,
    rows: item.rows,
    createdAt: item.createdAt,
    lastActivityAt: item.lastActivityAt,
    bytesIn: item.bytesIn,
    bytesOut: item.bytesOut,
    inputEvents: item.inputEvents,
    exited: item.exited,
    closed: item.closed,
    exitCode: item.exitCode,
    ...(item.exitedAt === undefined ? {} : { exitedAt: item.exitedAt }),
    ...(item.closedAt === undefined ? {} : { closedAt: item.closedAt }),
  })).sort((a, b) => a.createdAt - b.createdAt);

  return {
    now,
    terminals,
    totals: terminals.reduce((totals, terminal) => ({
      sessions: totals.sessions + 1,
      active: totals.active + Number(!terminal.exited && !terminal.closed),
      exited: totals.exited + Number(terminal.exited),
      closed: totals.closed + Number(terminal.closed),
      bytesIn: totals.bytesIn + terminal.bytesIn,
      bytesOut: totals.bytesOut + terminal.bytesOut,
      inputEvents: totals.inputEvents + terminal.inputEvents,
    }), { sessions: 0, active: 0, exited: 0, closed: 0, bytesIn: 0, bytesOut: 0, inputEvents: 0 }),
  };
}

module.exports = { createTerminalMetrics, recordTerminalIo, snapshotTerminalMetrics };
