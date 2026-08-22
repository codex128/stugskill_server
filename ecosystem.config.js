module.exports = {
  apps: [{
    name: 'stugskill_server',
    script: './players.js',
    instances: 'max',
    exec_mode: 'cluster',
    max_memory_restart: '1G',
    exp_backoff_restart_delay: 100,
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
