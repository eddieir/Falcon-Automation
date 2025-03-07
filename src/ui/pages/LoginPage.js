class LoginPage {
    constructor(page) {
        this.page = page;
        this.usernameField = "#user-name";
        this.passwordField = "#password";
        this.loginButton = "[data-test='login-button']";
    }

    async open(url) {
        await this.page.goto(url);
    }

    async login(username, password) {
        await this.page.fill(this.usernameField, username);
        await this.page.fill(this.passwordField, password);
        await this.page.click(this.loginButton);
    }
}

module.exports = LoginPage;
