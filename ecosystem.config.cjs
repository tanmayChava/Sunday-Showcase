/**
 * PM2 Ecosystem Configuration — Gravity Claw
 *
 * Manages the main SUNDAY bot as a PM2 process.
 * Start with:
 *
 *   pm2 start ecosystem.config.cjs
 *
 * Useful commands:
 *   pm2 status                  — see running processes
 *   pm2 logs                    — tail all logs
 *   pm2 logs gravity-claw       — tail bot logs only
 *   pm2 restart all             — restart everything
 *   pm2 stop all                — stop everything
 *   pm2 delete all              — remove from PM2 process list
 *   pm2 save                    — save current process list
 *   pm2 startup                 — generate OS auto-start script
 */

module.exports = {
    apps: [
        // ── Main Bot ────────────────────────────────────────────────────
        {
            name: "gravity-claw",
            script: "npx",
            args: "tsx src/index.ts",
            cwd: __dirname,
            interpreter: "none",

            // Restart policy
            autorestart: true,
            max_restarts: 10,
            restart_delay: 3000,
            watch: false, // bot handles its own hot-reload via Supabase Realtime

            // Environment
            env: {
                NODE_ENV: "production",
            },

            // Logging
            error_file: "./logs/bot-error.log",
            out_file: "./logs/bot-out.log",
            merge_logs: true,
            log_date_format: "YYYY-MM-DD HH:mm:ss Z",

            // Memory guard — restart if bot exceeds 512MB
            max_memory_restart: "512M",
        },


    ],
};
