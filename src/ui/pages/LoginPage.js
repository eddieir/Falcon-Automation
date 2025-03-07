const SelfHealingManager = require("../../core/SelfHealingManager");

class LoginPage {
    constructor(page) {
        this.page = page;
        this.selfHealer = new SelfHealingManager(page);
        this.usernameField = "#user-name";
        this.passwordField = "#password";
        this.loginButton = "[data-test='login-button']";
    }

    async open(url) {
        await this.page.goto(url);
    }

    async login(username, password) {
        await this.selfHealer.safeClick(this.usernameField);
        await this.page.fill(this.usernameField, username);
        await this.selfHealer.safeClick(this.passwordField);
        await this.page.fill(this.passwordField, password);
        await this.selfHealer.safeClick(this.loginButton, ["#login-btn", "button.login"]);
    }
}

module.exports = LoginPage;
