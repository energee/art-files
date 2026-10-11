// setup.ts — vitest setupFiles entry, run before every suite. React only
// honours act() when the environment opts in; without this every act() call
// still works but logs "not configured to support act(...)".
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
