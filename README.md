# 🚀 Falcon-Automation: AI-Powered Test Automation Framework

## 📌 Overview
**Falcon-Automation** is a highly scalable, AI-powered **Test Automation Framework** that supports:  
✅ **UI Automation (Page Object Model - POM)**  
✅ **API Testing**  
✅ **Database Testing**  
✅ **Self-Healing Mechanism** (AI-powered failure detection & auto-retry)  
✅ **Detailed Reporting (Screenshots, Logs, HTML Reports)**  
✅ **CI/CD Integration**  

This framework is designed for **high performance and maintainability**, following **OOP principles**.  

---

## 📌 Project Structure

```
Falcon-Automation/
│── src/
│   ├── core/               # Core framework logic (OOP-based)
│   │   ├── BaseTest.js
│   │   ├── BrowserManager.js
│   │   ├── APIClient.js
│   │   ├── DBClient.js
│   │   ├── ReportManager.js
│   │   ├── ConfigManager.js
│   ├── ui/                 # Page Object Model (POM) for UI Automation
│   │   ├── pages/
│   │   │   ├── LoginPage.js
│   │   │   ├── CheckoutPage.js
│   │   ├── tests/
│   │   │   ├── LoginTest.js
│   │   │   ├── CheckoutTest.js
│   ├── api/                # API Tests
│   │   ├── tests/
│   │   │   ├── UserApiTest.js
│   │   │   ├── ProductApiTest.js
│   ├── db/                 # Database Tests
│   │   ├── tests/
│   │   │   ├── UserDBTest.js
│   │   │   ├── OrderDBTest.js
│   ├── utils/              # Utilities
│   │   ├── Logger.js
│   │   ├── AIHelper.js
│   │   ├── RetryHandler.js
│   ├── reports/            # Reports & logs
│── config/                 # Configurations
│   ├── testConfig.json
│── .env
│── package.json
│── README.md
```

---

## 📌 Installation

### 🔹 **1. Clone the Repository**
```sh
git clone https://github.com/eddieir/Falcon-Automation.git
cd Falcon-Automation
```

### 🔹 **2. Install Dependencies**
```sh
npm install
```

### 🔹 **3. Configure Environment Variables**
Create a `.env` file and add:
```ini
DB_HOST=your_db_host
DB_PORT=your_db_port
DB_USER=your_db_user
DB_PASS=your_db_password
DB_NAME=your_db_name
OPENAI_API_KEY=your_openai_api_key
```

---

## 📌 Running Tests

### **✅ Run UI Test (Login)**
```sh
node src/ui/tests/LoginTest.js
```

### **✅ Run API Test**
```sh
node src/api/tests/UserApiTest.js
```

### **✅ Run Database Test**
```sh
node src/db/tests/UserDBTest.js
```

### **✅ Run All Tests**
```sh
npm run test:all
```

---

## 📌 Self-Healing Test Execution
The framework includes **AI-powered failure recovery**:
- **Detects missing elements & retries actions intelligently**  
- **Uses AI to analyze and suggest fixes**  
- **Captures screenshots for failures**  

---

## 📌 Generating Reports

### **✅ Generate & Open HTML Reports (Allure)**
```sh
npm run report
```
Reports include:
📊 **Pass/Fail/Skipped status**  
📸 **Screenshots for failed tests**  
📑 **Detailed error logs**  

---

## 📌 CI/CD Integration (GitHub Actions)
### **✅ Running Tests in CI/CD Pipeline**
Add this workflow to `.github/workflows/test_pipeline.yml`:

```yaml
name: Run Tests
on: push

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install dependencies
        run: npm install
      - name: Run tests
        run: npm run test:all
      - name: Upload Allure Report
        uses: actions/upload-artifact@v2
        with:
          name: allure-report
          path: allure-results
```

---

## 📌 Contributors
Developed by **Eddie**.  

For contributions, open a PR or report issues.

---

## 📌 License
**MIT License** - Free to use and modify.

---

🔥 **Now Falcon-Automation is ready for high-performance automation testing!** 🚀  
