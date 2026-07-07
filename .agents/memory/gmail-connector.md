---
name: Gmail Connector via Replit Connectors SDK
description: How to proxy Gmail API calls through the Replit connectors SDK, and Gmail OAuth scope limitations for this project.
---

## Usage

```ts
import { ReplitConnectors } from "@replit/connectors-sdk";
const connectors = new ReplitConnectors();
const res = await connectors.proxy("google-mail", "/gmail/v1/users/me/messages?...");
const data = await res.json();
```

The `.proxy()` return is a raw Response — must call `.json()` or `.text()` to read the body.

## Gmail OAuth scopes in this project

Connection: `conn_google-mail_01KH5GGA9757ZAH2M81F7HD87H`

Scopes granted:
- `gmail.addons.current.message.readonly` — reads message content
- `gmail.addons.current.message.metadata` — reads headers
- `gmail.send`
- `gmail.labels`
- `gmail.addons.current.action.compose`
- `gmail.addons.current.message.action`

**Note:** These are addon-scoped; `gmail.readonly` was NOT granted. Standard inbox listing (`GET /gmail/v1/users/me/messages`) may return 403 if the token doesn't satisfy it at runtime. Build graceful fallback/error handling in the sync route.

**How to apply:** When extending Gmail functionality, check error response from proxy and surface a clear message if scope is insufficient.
