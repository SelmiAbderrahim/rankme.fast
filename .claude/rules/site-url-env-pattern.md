# Site URL Environment Pattern - Strict Rule

## MANDATORY REQUIREMENT - ZERO TOLERANCE

**NEVER hardcode `localhost`, `127.0.0.1`, or any domain in source code.** All URLs MUST derive from environment variables.

## Architecture

```
.env (CLIENT_URL=http://localhost:3000, SERVER_URL=http://localhost:5000)
    ├── Server: process.env.SERVER_URL, process.env.CLIENT_URL
    └── Client: API base URL passed from server config or Webpack DefinePlugin
```

## Server Rules

Use `process.env` directly or via a config module:

```javascript
const SERVER_URL = process.env.SERVER_URL || "http://localhost:5000";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";

app.use(cors({ origin: CLIENT_URL }));
```

**FORBIDDEN:**

```javascript
const url = "http://localhost:5000";
const url = "https://myapp.com";
app.use(cors({ origin: "http://localhost:3000" }));
```

## Client Rules

API base URL should come from the build environment or a config file that reads from env:

```javascript
const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:5000";
```

**FORBIDDEN:**

```javascript
const API_BASE = "http://localhost:5000/api";
fetch("http://localhost:5000/api/users");
```

## Environment Variables

| Variable | Scope | Purpose |
|----------|-------|---------|
| `SERVER_URL` | Server | Backend origin |
| `CLIENT_URL` | Server (CORS) | Allowed frontend origin |
| `REACT_APP_API_URL` | Client (Webpack) | API base URL for fetch calls |

All defined in root `.env` only. See `environment-variables.md`.

## Allowed Exceptions

| Pattern | Reason |
|---------|--------|
| Test files (`__tests__/`, `.test.`, `.spec.`) | Test data is intentionally static |
| Seed / seeder scripts | Seed data is intentional |
| Markdown documentation | Static content, not runtime code |

## Validation

```bash
grep -rn "localhost:[0-9]" --include="*.js" --include="*.jsx" client/src/ server/ | \
  grep -v node_modules | grep -v __tests__ | grep -v \.test\. | grep -v \.spec\.
```

Matches outside the allowed exceptions list MUST be refactored to use env-derived values.
