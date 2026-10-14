# Test fixtures for the customer demo and saved-plan coverage

These are engineering fixtures for automated tests. They are **not** the customer demo; the customer demo runs against a local copy of AI-agency (see [docs/demo/CUSTOMER-DEMO.md](../../../docs/demo/CUSTOMER-DEMO.md)).

All of them are disposable, deterministic servers bound to `127.0.0.1` with no external resources.

| File | Used by | What it is |
|---|---|---|
| `checkoutServer.js` | `customer-demo-fixture`, `plan-cli` tests | A small checkout page. `setVersion(2)` changes only the primary button's id. Routes: `GET /checkout[?version=1\|2]`, `POST /api/order`, `GET /__version`. |
| `newsServer.js` | `news-recovery` tests | A News category filter that mimics the real page's shape. Versions: `hooks` (id + `data-testid`), `renamed` (only the `data-testid` changes), `bare` (no hooks) and `structural` (no hooks, plus a hidden status region that shifts the structure). |
| `stubTree.js`, `gateCleanupDriver.js` | `gate-cleanup` tests | Stand-ins for long-running processes, used to prove that SIGINT and SIGTERM stop every process, free every port and leave the working directory removable. |

```js
const { start } = require('./newsServer');
const app = await start();
app.setVersion('renamed');
app.url; await app.close();
```
