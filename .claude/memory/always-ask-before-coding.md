---
name: always-ask-before-coding
description: User requires Claude to present a solution plan FIRST and wait for explicit approval before writing any code
metadata:
  type: feedback
---

# Always Ask Before Writing Code

The user explicitly requires that for any code change (no matter how small), Claude must:

1. **First present a clear plan/solution** explaining what will be changed and why
2. **Wait for the user's explicit approval** ("写吧", "可以", "write code" etc.)
3. **Only then write the code**

Never write code immediately after diagnosing a problem. Always present the solution approach first and get confirmation.

**Why:** The user wants visibility and control over what changes are made to their codebase.

**How to apply:** After analyzing a bug or feature request, respond with a concise plan summary and end with "要我写代码吗？" or similar. Do NOT start editing files until the user explicitly says yes.
