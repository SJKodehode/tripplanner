module.exports = {
  apps: [
    {
      name: 'tripplanner-api',
      cwd: '.',
      script: 'bash',
      args: ['-lc', 'set -a; source .env; set +a; npm run start:api'],
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      watch: false,
      out_file: 'logs/api.out.log',
      error_file: 'logs/api.err.log',
    },
    {
      name: 'tripplanner-web',
      cwd: '.',
      script: 'bash',
      args: ['-lc', 'set -a; source .env; set +a; npm run start:web'],
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,
      watch: false,
      out_file: 'logs/web.out.log',
      error_file: 'logs/web.err.log',
    },
  ],
}
