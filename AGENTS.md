# WADUP development rules

WADUP is an existing application. The owner's existing design decisions take precedence over personal design recommendations.

- Redesign the website only when explicitly requested.
- Make surgical, targeted changes to the existing code. Preserve all existing layouts, colors, fonts, spacing, map behavior, and functionality unrelated to the task.
- Reuse existing functions and components whenever possible. Avoid unnecessary dependencies and duplicate code.
- Identify the root cause of bugs before attempting fixes. Avoid layering speculative fixes on top of broken code.
- Test changes before reporting completion. Support any claim that a fix works with verification.
- Protect the Supabase database and existing venue data.
- Respect all API budgets. Obtain authorization before introducing paid API usage.
- Test on a preview deployment before releasing to production.
- Maintain `TASKS.md` with outstanding tasks and completed work. Record verification for completed development work.
- Continue through authorized tasks without repeatedly requesting permission.
