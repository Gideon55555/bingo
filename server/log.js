// Timestamps on every log line. pm2 adds its own (time: true), so we only add them elsewhere
// (Passenger / DirectAdmin / plain `node`), where logs would otherwise have no time at all.
if (!process.env.pm_id && process.env.LOG_TIMESTAMPS !== 'false') {
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => orig(new Date().toISOString(), ...args);
  }
}
