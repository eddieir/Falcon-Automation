const BrowserManager = require("./BrowserManager");
const APIClient = require("./APIClient");
const DBClient = require("./DBClient");
const ReportManager = require("./ReportManager");
const Logger = require("../../utils/Logger");

class ServiceContainer {
    constructor() {
        this.services = new Map();
    }

    register(name, instance) {
        if (!this.services.has(name)) {
            this.services.set(name, instance);
        }
    }

    get(name) {
        if (!this.services.has(name)) {
            throw new Error(`❌ Service '${name}' not registered`);
        }
        return this.services.get(name);
    }
}

// Ensure DBClient only loads when required
const serviceContainer = new ServiceContainer();
serviceContainer.register("browserManager", new BrowserManager());
serviceContainer.register("apiClient", new APIClient());

try {
    serviceContainer.register("dbClient", new DBClient()); 
} catch (error) {
    Logger.error(`❌ Failed to register DBClient: ${error.message}`);
}

serviceContainer.register("reportManager", new ReportManager());

module.exports = serviceContainer;
