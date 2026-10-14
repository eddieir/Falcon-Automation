# Customer demo checkout fixture

Disposable, deterministic checkout app bound to `127.0.0.1` only (no external resources).

```js
const { start } = require('./checkoutServer');
const fx = await start({ port: 0 });
fx.setVersion(2); // v1 button id=checkout-submit, v2 id=place-order
fx.url; fx.getVersion(); fx.orderCount(); fx.reset(); await fx.close();
```

Routes: `GET /checkout[?version=1|2]`, `POST /api/order`, `GET /__version`; all else 404.
Only the primary button id changes between releases; markup and layout are otherwise identical.
