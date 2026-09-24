# URL Tab State - Strict Rule

## MANDATORY REQUIREMENT

**All tabbed interfaces MUST persist the active tab in URL query parameters.**

Tabs are navigation — they change what the user sees. Navigation state belongs in the URL so that:
- Direct links to a specific tab work (shareable, bookmarkable)
- Browser back/forward navigates between tabs
- Page refresh preserves the active tab

## Pattern

### Reading Active Tab

```javascript
import { useLocation, useNavigate } from "react-router-dom";

function useTabParam(defaultTab = "general") {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const activeTab = params.get("tab") || defaultTab;

  const setActiveTab = (tab) => {
    params.set("tab", tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  return [activeTab, setActiveTab];
}
```

### Tab Component

```jsx
function ServiceDetail({ serviceId }) {
  const [activeTab, setActiveTab] = useTabParam("general");

  return (
    <div>
      <nav>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={activeTab === tab.id ? "active" : ""}
          >
            {tab.label}
          </button>
        ))}
      </nav>
      {activeTab === "general" && <GeneralTab />}
      {activeTab === "settings" && <SettingsTab />}
      {activeTab === "logs" && <LogsTab />}
    </div>
  );
}
```

## Rules

1. **Parameter name** — Always use `tab` as the query parameter key
2. **Default value** — Always provide a default tab; never show a blank state
3. **`replace: true`** — Use `replace` so tab switches don't pollute browser history
4. **Validation** — If the query param value doesn't match a valid tab, fall back to the default
5. **No hash-based tabs** — Never use `#tab-name` for tab state; use `?tab=name`

## FORBIDDEN

```jsx
// WRONG - local state, not in URL
const [activeTab, setActiveTab] = useState("general");

// WRONG - hash-based
window.location.hash = "settings";

// WRONG - no tab persistence at all
{showSettings ? <SettingsTab /> : <GeneralTab />}
```

## Validation Checklist

- [ ] Active tab readable from URL query parameter `?tab=`
- [ ] Clicking a tab updates the URL
- [ ] Refreshing the page preserves the active tab
- [ ] Invalid tab values fall back to the default
- [ ] Browser back/forward works between tabs
