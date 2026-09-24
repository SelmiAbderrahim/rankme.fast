# MERN Named Exports - Strict Rule

## MANDATORY REQUIREMENT

**Prefer named exports over default exports.** Named exports improve discoverability, enable reliable refactoring, and prevent naming confusion across the codebase.

## Why

| Problem with `export default` | Named export fix |
|-------------------------------|------------------|
| Import can use any name (`import Foo from './bar'`) | Name is enforced at import site |
| IDE autocomplete is less reliable | IDE can suggest exact names |
| Refactoring (rename) misses import sites | Rename propagates through all imports |
| Re-exporting requires remembering the name | Re-export by name is explicit |

## Rules

### Use Named Exports For

- React components
- Redux actions and action creators
- Redux reducers
- Mongoose models
- Utility functions
- Constants
- Express route handlers
- Middleware functions

### CORRECT

```javascript
// components/Header.js
export const Header = () => { /* ... */ };

// actions/auth.js
export const login = (credentials) => ({ type: "LOGIN", payload: credentials });
export const logout = () => ({ type: "LOGOUT" });

// reducers/auth.js
export const authReducer = (state = {}, action) => { /* ... */ };

// models/user.js
export const User = mongoose.model("User", userSchema);
```

```javascript
// Importing
import { Header } from "../components/Header";
import { login, logout } from "../actions/auth";
import { authReducer } from "../reducers/auth";
import { User } from "../models/user";
```

### FORBIDDEN (Default Exports)

```javascript
// WRONG - default export
export default Header;

// WRONG - default export with inline name
export default function Header() { /* ... */ }

// WRONG - default export of a constant
const Header = () => { /* ... */ };
export default Header;
```

### Allowed Exceptions

Default exports are acceptable ONLY for:

1. **Express app entry point** — `server/index.js` may use `export default app`
2. **Mongoose model files when using `model()` return** — but prefer the named pattern above
3. **Config files** — `export default { ... }` for config objects is acceptable

## Re-exports in Feature Modules

Feature `index.js` files should use named re-exports:

```javascript
// features/auth/index.js — CORRECT
export { LoginForm } from "./components/LoginForm";
export { login, logout } from "./actions";
export { authReducer } from "./reducer";

// WRONG
export { default } from "./components/LoginForm";
```

## File Naming

File names should match the primary export name in `camelCase` or `PascalCase`:

| Export | File Name |
|--------|-----------|
| `authReducer` | `authReducer.js` |
| `LoginForm` | `LoginForm.js` |
| `formatDate` | `formatDate.js` |

## Validation Checklist

- [ ] No `export default` on components, actions, reducers, or utilities
- [ ] All imports use curly braces: `import { Name } from "..."` 
- [ ] File names match primary export names
- [ ] Feature `index.js` files use named re-exports
