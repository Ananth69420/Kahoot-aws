const path = require('node:path');

module.exports = {
  apps: [{
    name: 'quizblitz-api',
    cwd: path.join(__dirname, '..', 'server'),
    script: 'src/index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '450M',
    env_production: { NODE_ENV: 'production' },
  }],
};
