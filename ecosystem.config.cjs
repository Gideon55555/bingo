// pm2 process config for a VPS:  pm2 start ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'bingo',
    script: 'server/index.js',
    instances: 1,            // MUST be 1 — game state lives in memory
    exec_mode: 'fork',
    env: { NODE_ENV: 'production' },
    kill_timeout: 10000,     // give the server time to refund unfinished rounds on restart
    max_memory_restart: '900M',   // ~2,000 players online use ~400 MB; restart only if something leaks
    time: true,              // timestamps in logs
  }],
};
