const http   = require("http");
const path   = require("path");
const fs     = require("fs");
const Logger = require("../../utils/Logger");

/**
 * Dashboard — real-time test execution monitor.
 *
 * Phase 3 feature: express + socket.io were already installed as dependencies
 * but were never connected to any code path.  This module wires them into a
 * localhost web server that streams every test event (start, pass, fail, skip,
 * healing, explorer page) to a browser dashboard in real time.
 *
 * Usage:
 *   const Dashboard = require('./src/core/Dashboard');
 *   const dashboard = new Dashboard();
 *   await dashboard.start();            // opens http://localhost:3000
 *
 *   dashboard.emit('testPass', { name: 'Login', duration: 1234 });
 *   dashboard.emit('healingEvent', { original: '#btn', resolved: '[data-test]' });
 *
 *   await dashboard.stop();             // graceful shutdown
 *
 * The dashboard also registers itself as the Middleware emitter so lifecycle
 * events (testStart / testEnd) fire automatically without any call-site changes.
 */
class Dashboard {
    /**
     * @param {Object} opts
     * @param {number} [opts.port=3000] - HTTP port to listen on
     */
    constructor({ port = 3000 } = {}) {
        this.port    = port;
        this._events = []; // full history so late-joining tabs get replay
        this._io     = null;
        this._server = null;
    }

    /**
     * Start the HTTP + WebSocket server and print the dashboard URL.
     */
    async start() {
        // Lazy-require to avoid crashing processes that don't need the dashboard
        const express   = require("express");
        const socketIO  = require("socket.io");
        const Middleware = require("./Middleware");

        const app = express();
        app.use(express.json());
        app.use(express.static(path.join(__dirname, "..", "dashboard")));

        app.get("/events", (_req, res) => {
            res.json(this._events);
        });

        // Lets a separate `node` process (e.g. tests/ui/LoginTest.js run on
        // its own) report into this already-running dashboard by POSTing
        // here — see Middleware.emit()'s DASHBOARD_URL fallback.
        app.post("/emit", (req, res) => {
            const { name, payload } = req.body || {};
            if (typeof name === "string") {
                this.emit(name, payload || {});
            }
            res.status(204).end();
        });

        this._server = http.createServer(app);
        this._io     = new socketIO.Server(this._server, {
            cors: { origin: "*" },
        });

        this._io.on("connection", (socket) => {
            // Replay full history so the new client sees everything
            socket.emit("replay", this._events);
        });

        await new Promise((resolve, reject) => {
            this._server.once("error", reject);
            this._server.listen(this.port, () => {
                this._server.removeListener("error", reject);
                resolve();
            });
        });
        Logger.info(`🖥  Dashboard → http://localhost:${this.port}`);

        // Wire Middleware lifecycle events into the dashboard
        Middleware.setEmitter((name, payload) => this.emit(name, payload));
    }

    /**
     * Emit an event to all connected dashboard tabs and append to history.
     * @param {string} name - Event name (testStart, testPass, testFail, …)
     * @param {Object} payload
     */
    emit(name, payload = {}) {
        const event = { name, payload, timestamp: Date.now() };
        this._events.push(event);
        if (this._io) {
            this._io.emit("event", event);
        }
    }

    /** Gracefully shut down the HTTP server. */
    async stop() {
        if (this._server) {
            await new Promise((resolve) => this._server.close(resolve));
            Logger.info("🛑 Dashboard stopped.");
        }
    }
}

module.exports = Dashboard;
