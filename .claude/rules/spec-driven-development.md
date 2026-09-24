# Spec-Driven Development - Best Practice Guide

## Overview

Spec-Driven Development (SDD) is a recommended methodology for features of meaningful complexity. The workflow: constitution → specify → clarify → plan → tasks → analyze → checklist → implement.

Not every bug fix or one-liner needs the full workflow. Use judgment — a missing semicolon doesn't need a spec. A new billing module does.

## Core Principles

### 1. Spec-First Development

- All features start with specification
- Specifications define problem space, not solution space
- No implementation details in specifications
- Specifications must have acceptance criteria

### 2. Complete Workflow Phases

1. **Constitution** — Define project principles and constraints
2. **Specification** — Define requirements (what and why, not how)
3. **Clarification** — Resolve gaps and ambiguities
4. **Planning** — Technical implementation approach
5. **Task Breakdown** — Actionable steps, each < 2 hours
6. **Analysis** — Validate consistency across all artifacts
7. **Quality Checklist** — Validate completeness
8. **Implementation** — Build the feature

### 3. Quality Gates

- Must pass quality checklist before implementation
- Must resolve all critical issues from analysis
- Each task has clear acceptance criteria

## Specification Quality

**Required Elements:**
- Problem statement (what and why)
- User stories with acceptance criteria
- Functional requirements
- Non-functional requirements (performance, security, accessibility)
- Success criteria
- Edge cases and error handling

**Anti-Patterns (AVOID):**
- Specifying implementation technologies
- Using vague language ("fast", "easy")
- Skipping non-functional requirements
- Missing success criteria

**Example:**

WRONG:
```markdown
User can view a dashboard with charts.
```

CORRECT:
```markdown
User can view account activity on a dashboard.
- Recent transactions display in chronological order (newest first)
- Each transaction shows date, amount, and type
- Dashboard loads within 2 seconds with 100 transactions
- Empty state shows a helpful message when no transactions exist
```

## Task Breakdown Quality

- Tasks are completable in < 2 hours
- Each task has clear acceptance criteria
- Dependencies between tasks are documented
- Testing is included (not just implementation)

## Exceptions

| Scenario | Approach |
|----------|----------|
| Bug fixes | Skip full workflow; document the fix |
| Emergency fixes | Expedite with minimal documentation |
| Documentation updates | Skip technical phases |
| Refactoring (behavior unchanged) | Simplified workflow |

## Summary

Spec-Driven Development is **recommended** for features of meaningful complexity. Small changes don't need it. When in doubt, start with a specification — you can always simplify the workflow if the feature turns out to be trivial.
