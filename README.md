# Control Deck — DelegateBoard

A calm card for handing tasks to AI agents while keeping full visibility into cost and timing.

```bash
npm install
npm run dev     # demo at http://localhost:5173
npm run build   # type-check + production build
```

The component lives in a single file: [`src/DelegateBoard.tsx`](src/DelegateBoard.tsx)
(React + TypeScript, Tailwind classes, Framer Motion). Drop it into any project that has
those three; Tailwind needs `darkMode: "class"` for the dark theme.

```tsx
<DelegateBoard />                       // demo data, manual mode
<DelegateBoard defaultAuto tasks={...} agents={...} onChange={(board) => ...} />
```

- **Drag** a task card or an assigned chip onto an agent (or back to Unassigned). A dashed slot
  shows where it will land, and a floating pill previews `+$ / +min / until HH:MM`. `Esc` cancels.
- **Keyboard**: focus a task and press `1`–`4` to assign it to that agent; `Delete` on a chip
  returns it to Unassigned.
- **Auto** hands each unassigned task to the agent who frees up soonest (the first free agent
  wins ties). `+ New` adds a task so you can watch it work.
- Cost = estimated minutes × the agent's per-minute rate. "Busy until" is the demo clock
  (`startTime`, default: mount time) plus the minutes queued.
