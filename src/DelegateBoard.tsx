import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
  type Transition,
} from "framer-motion";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type TaskKind = "code" | "research" | "content" | "ops";
export type AgentTone = "orange" | "violet" | "emerald" | "sky";

export interface DelegateTask {
  id: string;
  title: string;
  /** Estimated working time in minutes. */
  minutes: number;
  kind: TaskKind;
}

export interface DelegateAgent {
  id: string;
  name: string;
  model: string;
  /** Cost in dollars per working minute. */
  ratePerMin: number;
  tone: AgentTone;
}

export interface BoardState {
  unassigned: string[];
  queues: Record<string, string[]>;
}

export interface DelegateBoardProps {
  tasks?: DelegateTask[];
  agents?: DelegateAgent[];
  /** "Now" for the demo clock. Busy-until times are computed from this. */
  startTime?: Date;
  defaultAuto?: boolean;
  onChange?: (board: BoardState) => void;
  className?: string;
}

/* -------------------------------------------------------------------------- */
/*  Sample data                                                               */
/* -------------------------------------------------------------------------- */

const SAMPLE_TASKS: DelegateTask[] = [
  { id: "t1", title: "Fix flaky checkout test", minutes: 20, kind: "code" },
  { id: "t2", title: "Summarize churn calls", minutes: 15, kind: "research" },
  { id: "t3", title: "Update pricing page", minutes: 10, kind: "content" },
  { id: "t4", title: "Clean up CRM duplicates", minutes: 18, kind: "ops" },
];

const SAMPLE_AGENTS: DelegateAgent[] = [
  { id: "researcher", name: "Researcher", model: "Opus 5.5", ratePerMin: 0.08, tone: "orange" },
  { id: "writer", name: "Writer", model: "Sonnet 5.5", ratePerMin: 0.03, tone: "violet" },
  { id: "coder", name: "Coder", model: "GPT-6 Sol", ratePerMin: 0.06, tone: "emerald" },
  { id: "ops", name: "Ops", model: "Gemini 3.8 Flash", ratePerMin: 0.01, tone: "sky" },
];

/** Used by the "+ New" button so Auto mode always has something to chew on. */
const TASK_POOL: Omit<DelegateTask, "id">[] = [
  { title: "Triage support inbox", minutes: 12, kind: "ops" },
  { title: "Draft release notes", minutes: 14, kind: "content" },
  { title: "Benchmark search latency", minutes: 22, kind: "code" },
  { title: "Compare competitor pricing", minutes: 16, kind: "research" },
  { title: "Reconcile Stripe payouts", minutes: 9, kind: "ops" },
  { title: "Refactor auth middleware", minutes: 25, kind: "code" },
];

/* -------------------------------------------------------------------------- */
/*  Motion + style tokens                                                     */
/* -------------------------------------------------------------------------- */

const spring: Transition = { type: "spring", stiffness: 520, damping: 38, mass: 0.8 };
const softSpring: Transition = { type: "spring", stiffness: 300, damping: 30 };

const KIND_STYLE: Record<TaskKind, { badge: string; label: string }> = {
  code: { badge: "bg-sky-100 text-sky-600 dark:bg-sky-400/15 dark:text-sky-300", label: "Code" },
  research: {
    badge: "bg-violet-100 text-violet-600 dark:bg-violet-400/15 dark:text-violet-300",
    label: "Research",
  },
  content: {
    badge: "bg-amber-100 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300",
    label: "Content",
  },
  ops: {
    badge: "bg-emerald-100 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-300",
    label: "Ops",
  },
};

const TONE_STYLE: Record<AgentTone, string> = {
  orange: "from-orange-300 to-orange-500",
  violet: "from-violet-300 to-violet-500",
  emerald: "from-emerald-300 to-emerald-500",
  sky: "from-sky-300 to-sky-500",
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

const money = (n: number) => `$${n.toFixed(2)}`;
const addMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function moveTask(b: BoardState, id: string, target: string, index?: number): BoardState {
  const unassigned = b.unassigned.filter((x) => x !== id);
  const queues: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(b.queues)) queues[k] = v.filter((x) => x !== id);
  const list = target === "unassigned" ? unassigned : queues[target];
  if (!list) return b;
  list.splice(index ?? list.length, 0, id);
  return { unassigned, queues };
}

interface Over {
  target: string; // "unassigned" or an agent id
  index: number; // insertion index within the target list, ignoring the dragged task
}

interface DragState {
  taskId: string;
  from: string;
  origin: Over;
  over: Over | null;
  phase: "active" | "landing";
  variant: "card" | "chip";
  offX: number;
  offY: number;
}

type Preview =
  | { kind: "assign"; agent: string; cost: number; minutes: number; until: string }
  | { kind: "reorder"; position: number }
  | { kind: "unassign"; saved: number };

/* -------------------------------------------------------------------------- */
/*  Icons                                                                     */
/* -------------------------------------------------------------------------- */

const Svg = ({ children, size = 14 }: { children: React.ReactNode; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    {children}
  </svg>
);

function KindIcon({ kind, size }: { kind: TaskKind; size?: number }) {
  switch (kind) {
    case "code":
      return (
        <Svg size={size}>
          <path d="M6 4.5 2.5 8 6 11.5M10 4.5 13.5 8 10 11.5" />
        </Svg>
      );
    case "research":
      return (
        <Svg size={size}>
          <circle cx="7" cy="7" r="4" />
          <path d="m10 10 3.5 3.5" />
        </Svg>
      );
    case "content":
      return (
        <Svg size={size}>
          <path d="M4 2.5h5.5L12.5 5.5v8h-8.5zM9 2.5v3.5h3.5M6 9h4.5M6 11.5h3" />
        </Svg>
      );
    case "ops":
      return (
        <Svg size={size}>
          <ellipse cx="8" cy="4" rx="5" ry="2" />
          <path d="M3 4v4c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8v4c0 1.1 2.2 2 5 2s5-.9 5-2V8" />
        </Svg>
      );
  }
}

function AgentGlyph({ id }: { id: string }) {
  // Tiny abstract "logos" so each agent reads as a different model at a glance.
  const paths: Record<string, React.ReactNode> = {
    researcher: <path d="M8 2v12M2 8h12M3.8 3.8l8.4 8.4M12.2 3.8l-8.4 8.4" />,
    writer: <path d="M3 8c0-3 2-5 5-5s5 2 5 5-2 5-5 5c-1 0-2-.3-3-1l-2 1 .8-2.6C3.3 10.4 3 9.3 3 8z" />,
    coder: <path d="M8 2 13.2 5v6L8 14 2.8 11V5z" />,
    ops: <path d="M8 2l1.8 4.2L14 8l-4.2 1.8L8 14l-1.8-4.2L2 8l4.2-1.8z" />,
  };
  return <Svg size={14}>{paths[id] ?? <circle cx="8" cy="8" r="4" />}</Svg>;
}

const Sparkle = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
    <path d="M8 0.5c.4 3.6 1.9 5.9 6.5 7.5-4.6 1.6-6.1 3.9-6.5 7.5-.4-3.6-1.9-5.9-6.5-7.5C6.1 6.4 7.6 4.1 8 .5z" />
  </svg>
);

const Grip = () => (
  <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden>
    {[3, 8, 13].map((y) => (
      <g key={y}>
        <circle cx="2.5" cy={y} r="1.1" />
        <circle cx="7.5" cy={y} r="1.1" />
      </g>
    ))}
  </svg>
);

/* -------------------------------------------------------------------------- */
/*  Small animated atoms                                                      */
/* -------------------------------------------------------------------------- */

/** Text that slides up when its value changes. */
function Swap({ value, className = "" }: { value: string; className?: string }) {
  return (
    <span className={`relative inline-flex overflow-hidden align-bottom ${className}`}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ y: "70%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "-70%", opacity: 0 }}
          transition={spring}
          className="inline-block whitespace-nowrap tabular-nums"
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** Dollar amount that counts toward its new value. */
function Money({ value }: { value: number }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => money(Math.max(0, v)));
  useEffect(() => {
    const controls = animate(mv, value, { duration: 0.55, ease: [0.22, 1, 0.36, 1] });
    return () => controls.stop();
  }, [mv, value]);
  return <motion.span className="tabular-nums">{text}</motion.span>;
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label="Auto-assign new tasks"
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900 ${
        checked ? "bg-blue-500" : "bg-neutral-300 dark:bg-neutral-700"
      }`}
    >
      <motion.span
        className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm"
        animate={{ x: checked ? 16 : 0 }}
        transition={spring}
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Task faces (shared by the list items and the floating drag ghost)         */
/* -------------------------------------------------------------------------- */

function CardFace({ task, lifted = false }: { task: DelegateTask; lifted?: boolean }) {
  return (
    <div
      className={`flex h-[52px] items-center gap-2.5 rounded-xl border bg-white px-2.5 transition-colors dark:bg-neutral-800/80 ${
        lifted
          ? "border-blue-300 shadow-[0_16px_32px_-8px_rgba(15,23,42,.28)] dark:border-blue-400/50 dark:shadow-[0_16px_32px_-8px_rgba(0,0,0,.7)]"
          : "border-neutral-200 shadow-[0_1px_2px_rgba(16,24,40,.04)] group-hover:border-neutral-300 dark:border-white/[0.08] dark:group-hover:border-white/20"
      }`}
    >
      <span className="text-neutral-300 transition-colors group-hover:text-neutral-400 dark:text-neutral-600 dark:group-hover:text-neutral-400">
        <Grip />
      </span>
      <span
        className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${KIND_STYLE[task.kind].badge}`}
        title={KIND_STYLE[task.kind].label}
      >
        <KindIcon kind={task.kind} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 dark:text-neutral-100">
        {task.title}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-neutral-400 dark:text-neutral-500">
        ~{task.minutes} min
      </span>
    </div>
  );
}

function ChipFace({ task, lifted = false }: { task: DelegateTask; lifted?: boolean }) {
  return (
    <div
      className={`inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border bg-white py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200 ${
        lifted
          ? "border-blue-300 shadow-[0_12px_24px_-6px_rgba(15,23,42,.3)] dark:border-blue-400/50 dark:shadow-[0_12px_24px_-6px_rgba(0,0,0,.7)]"
          : "border-neutral-200 group-hover:border-neutral-300 dark:border-white/[0.08] dark:group-hover:border-white/20"
      }`}
    >
      <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${KIND_STYLE[task.kind].badge}`}>
        <KindIcon kind={task.kind} size={11} />
      </span>
      <span className="truncate">{task.title}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Draggable list items                                                      */
/* -------------------------------------------------------------------------- */

interface ItemProps {
  task: DelegateTask;
  /** Dropped items fade in a beat late so the landing ghost can arrive first. */
  landed: boolean;
  onGrab: (e: ReactPointerEvent<HTMLElement>, el: HTMLElement) => void;
  onKey: (e: ReactKeyboardEvent<HTMLElement>) => void;
  hint: string;
}

const itemVariants = {
  exit: (instant: boolean) =>
    instant
      ? { opacity: 0, transition: { duration: 0 } }
      : { opacity: 0, scale: 0.9, transition: { duration: 0.16 } },
};

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-neutral-900";

const TaskCard = forwardRef<HTMLDivElement, ItemProps>(function TaskCard(
  { task, landed, onGrab, onKey, hint },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      layout="position"
      data-item
      variants={itemVariants}
      initial={{ opacity: 0, scale: landed ? 1 : 0.92 }}
      animate={{ opacity: 1, scale: 1, transition: { ...spring, delay: landed ? 0.14 : 0 } }}
      exit="exit"
      transition={spring}
      tabIndex={0}
      title={hint}
      aria-label={`${task.title}, about ${task.minutes} minutes. ${hint}`}
      onPointerDown={(e) => onGrab(e, e.currentTarget)}
      onKeyDown={onKey}
      className={`group cursor-grab touch-none select-none rounded-xl active:cursor-grabbing ${focusRing}`}
    >
      <CardFace task={task} />
    </motion.div>
  );
});

const TaskChip = forwardRef<HTMLDivElement, ItemProps>(function TaskChip(
  { task, landed, onGrab, onKey, hint },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      layout="position"
      data-item
      variants={itemVariants}
      initial={{ opacity: 0, scale: landed ? 1 : 0.8 }}
      animate={{ opacity: 1, scale: 1, transition: { ...spring, delay: landed ? 0.14 : 0 } }}
      exit="exit"
      transition={spring}
      tabIndex={0}
      title={`${task.title} · ~${task.minutes} min. ${hint}`}
      aria-label={`${task.title}, about ${task.minutes} minutes. ${hint}`}
      onPointerDown={(e) => onGrab(e, e.currentTarget)}
      onKeyDown={onKey}
      className={`group max-w-full cursor-grab touch-none select-none rounded-full active:cursor-grabbing ${focusRing}`}
    >
      <ChipFace task={task} />
    </motion.div>
  );
});

/** Dashed placeholder showing where the dragged task will land. */
const Slot = forwardRef<HTMLDivElement, { variant: "card" | "chip" }>(function Slot({ variant }, ref) {
  return (
    <motion.div
      ref={ref}
      layout="position"
      data-slot
      variants={itemVariants}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit="exit"
      custom
      transition={spring}
      className={`border border-dashed border-blue-400/60 bg-blue-500/[0.06] dark:border-blue-400/40 dark:bg-blue-400/[0.07] ${
        variant === "card" ? "h-[52px] rounded-xl" : "h-7 w-28 rounded-full"
      }`}
    />
  );
});

/* -------------------------------------------------------------------------- */
/*  Floating drag ghost                                                       */
/* -------------------------------------------------------------------------- */

interface GhostProps {
  drag: DragState;
  task: DelegateTask;
  preview: Preview | null;
  x: MotionValue<number>;
  y: MotionValue<number>;
  w: MotionValue<number>;
  h: MotionValue<number>;
  dark: boolean;
}

function DragGhost({ drag, task, preview, x, y, w, h, dark }: GhostProps) {
  const active = drag.phase === "active";
  return createPortal(
    <div className={dark ? "dark" : ""}>
      <motion.div
        className="pointer-events-none fixed left-0 top-0 z-[100]"
        style={{ x, y, width: w, height: h }}
        initial={{ scale: 1, rotate: 0 }}
        animate={
          active
            ? { scale: 1.035, rotate: 1.2, opacity: 1 }
            : { scale: 0.97, rotate: 0, opacity: 0, transition: { duration: 0.18, delay: 0.1 } }
        }
        transition={spring}
      >
        {drag.variant === "card" ? <CardFace task={task} lifted /> : <ChipFace task={task} lifted />}
        <AnimatePresence mode="popLayout">
          {active && preview && (
            <motion.div
              key={preview.kind + ("agent" in preview ? preview.agent : "")}
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
              transition={spring}
              className="absolute left-0 top-full mt-2 flex w-max items-center gap-1.5 whitespace-nowrap rounded-full bg-neutral-900 px-2.5 py-1 text-[11px] font-medium tabular-nums text-neutral-100 shadow-lg dark:bg-white dark:text-neutral-800"
            >
              {preview.kind === "assign" && (
                <>
                  <span className="font-semibold text-emerald-300 dark:text-emerald-600">
                    +{money(preview.cost)}
                  </span>
                  <span>+{preview.minutes}m</span>
                  <span className="text-neutral-400 dark:text-neutral-500">until {preview.until}</span>
                </>
              )}
              {preview.kind === "reorder" && <span>Queue position {preview.position}</span>}
              {preview.kind === "unassign" && (
                <>
                  <span className="font-semibold text-sky-300 dark:text-sky-600">−{money(preview.saved)}</span>
                  <span className="text-neutral-400 dark:text-neutral-500">back to Unassigned</span>
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>,
    document.body,
  );
}

/* -------------------------------------------------------------------------- */
/*  Agent row                                                                 */
/* -------------------------------------------------------------------------- */

type Entry = { type: "task"; id: string } | { type: "slot" };

interface AgentRowProps {
  agent: DelegateAgent;
  entries: Entry[];
  until: string | null;
  dragging: boolean;
  hovered: boolean;
  instant: boolean;
  landedId: string | null;
  tasks: Record<string, DelegateTask>;
  hint: string;
  onGrab: (e: ReactPointerEvent<HTMLElement>, el: HTMLElement, id: string, from: string) => void;
  onKey: (e: ReactKeyboardEvent<HTMLElement>, id: string, from: string) => void;
}

function AgentRow({
  agent,
  entries,
  until,
  dragging,
  hovered,
  instant,
  landedId,
  tasks,
  hint,
  onGrab,
  onKey,
}: AgentRowProps) {
  return (
    <motion.div layout="position" transition={spring} data-drop={agent.id} className="py-1">
      <div
        className={`rounded-xl border p-3 transition-[background-color,border-color,box-shadow] duration-200 ${
          hovered
            ? "border-blue-400/70 bg-blue-50/70 shadow-[0_0_0_4px_rgba(59,130,246,.10)] dark:border-blue-400/50 dark:bg-blue-400/[0.07]"
            : dragging
              ? "border-dashed border-neutral-300 bg-white dark:border-white/15 dark:bg-white/[0.02]"
              : "border-neutral-200 bg-white shadow-[0_1px_2px_rgba(16,24,40,.03)] dark:border-white/[0.08] dark:bg-white/[0.03]"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br text-white shadow-inner ${TONE_STYLE[agent.tone]}`}
          >
            <AgentGlyph id={agent.id} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold leading-tight text-neutral-900 dark:text-neutral-100">
              {agent.name}
            </div>
            <div className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
              {agent.model}
              <span className="ml-1.5 tabular-nums text-neutral-400 dark:text-neutral-500">
                {money(agent.ratePerMin)}/min
              </span>
            </div>
          </div>
          <AnimatePresence mode="wait" initial={false}>
            {until === null ? (
              <motion.span
                key="free"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.12 }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/15 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Free
              </motion.span>
            ) : (
              <motion.span
                key="busy"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.12 }}
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-500 ring-1 ring-inset ring-neutral-200 dark:bg-white/[0.06] dark:text-neutral-400 dark:ring-white/10"
              >
                Busy until <Swap value={until} />
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <div className="relative mt-3 flex min-h-7 flex-wrap items-center gap-1.5">
          <AnimatePresence mode="popLayout" initial={false} custom={instant}>
            {entries.map((entry) =>
              entry.type === "slot" ? (
                <Slot key="slot" variant="chip" />
              ) : (
                <TaskChip
                  key={entry.id}
                  task={tasks[entry.id]}
                  landed={landedId === entry.id}
                  hint={hint}
                  onGrab={(e, el) => onGrab(e, el, entry.id, agent.id)}
                  onKey={(e) => onKey(e, entry.id, agent.id)}
                />
              ),
            )}
          </AnimatePresence>
          {entries.length === 0 && (
            <span className="pointer-events-none select-none px-1 text-xs text-neutral-400 dark:text-neutral-600">
              {dragging ? "Drop to assign" : "Nothing queued"}
            </span>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* -------------------------------------------------------------------------- */
/*  DelegateBoard                                                             */
/* -------------------------------------------------------------------------- */

export default function DelegateBoard({
  tasks = SAMPLE_TASKS,
  agents = SAMPLE_AGENTS,
  startTime,
  defaultAuto = false,
  onChange,
  className = "",
}: DelegateBoardProps) {
  const [start] = useState(() => {
    const d = startTime ? new Date(startTime) : new Date();
    d.setSeconds(0, 0);
    return d;
  });
  const [taskMap, setTaskMap] = useState<Record<string, DelegateTask>>(() =>
    Object.fromEntries(tasks.map((t) => [t.id, t])),
  );
  const [board, setBoard] = useState<BoardState>(() => ({
    unassigned: tasks.map((t) => t.id),
    queues: Object.fromEntries(agents.map((a) => [a.id, [] as string[]])),
  }));
  const [auto, setAuto] = useState(defaultAuto);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [landedId, setLandedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const rootRef = useRef<HTMLElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const boardRef = useRef(board);
  boardRef.current = board;
  const taskMapRef = useRef(taskMap);
  taskMapRef.current = taskMap;
  const seq = useRef(0);

  const gx = useMotionValue(0);
  const gy = useMotionValue(0);
  const gw = useMotionValue(0);
  const gh = useMotionValue(0);

  const agentById = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a])), [agents]);

  useEffect(() => onChange?.(board), [board, onChange]);

  /* ---- derived queue stats ------------------------------------------------ */

  const minutesIn = (ids: string[], map = taskMap) => ids.reduce((s, id) => s + (map[id]?.minutes ?? 0), 0);

  const stats = agents.map((a) => {
    const ids = board.queues[a.id] ?? [];
    const minutes = minutesIn(ids);
    return {
      agent: a,
      minutes,
      cost: minutes * a.ratePerMin,
      until: ids.length ? clock(addMinutes(start, minutes)) : null,
    };
  });
  const totalCost = stats.reduce((s, x) => s + x.cost, 0);

  /* ---- committing moves --------------------------------------------------- */

  const commit = (id: string, target: string, index?: number, dropped = false) => {
    const task = taskMapRef.current[id];
    if (!task) return;
    setLandedId(dropped ? id : null);
    setBoard((b) => moveTask(b, id, target, index));
    setAnnouncement(
      target === "unassigned"
        ? `${task.title} moved back to Unassigned`
        : `${task.title} assigned to ${agentById[target]?.name ?? target}`,
    );
  };

  /* ---- Auto: hand the next task to whoever frees up first ----------------- */

  useEffect(() => {
    if (!auto || drag || board.unassigned.length === 0) return;
    const timer = window.setTimeout(() => {
      const b = boardRef.current;
      const id = b.unassigned[0];
      if (!id) return;
      let best = agents[0];
      let bestMin = Infinity;
      for (const a of agents) {
        const m = minutesIn(b.queues[a.id] ?? [], taskMapRef.current);
        if (m < bestMin) [best, bestMin] = [a, m]; // strict < keeps the first free agent on ties
      }
      if (best) commit(id, best.id);
    }, 420);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, board, drag, agents]);

  const addTask = () => {
    const tpl = TASK_POOL[seq.current % TASK_POOL.length];
    const id = `new-${++seq.current}`;
    setTaskMap((m) => ({ ...m, [id]: { ...tpl, id } }));
    setBoard((b) => ({ ...b, unassigned: [...b.unassigned, id] }));
  };

  /* ---- pointer dragging --------------------------------------------------- */

  const hitTest = (cx: number, cy: number): Over | null => {
    const root = rootRef.current;
    const zone = document.elementFromPoint(cx, cy)?.closest<HTMLElement>("[data-drop]");
    if (!root || !zone || !root.contains(zone)) return null;
    const target = zone.dataset.drop!;
    const items = Array.from(zone.querySelectorAll<HTMLElement>("[data-item]"));
    let index = 0;
    for (const el of items) {
      const r = el.getBoundingClientRect();
      const before =
        target === "unassigned"
          ? r.top + r.height / 2 < cy
          : r.bottom < cy || (r.top <= cy && r.left + r.width / 2 < cx);
      if (before) index++;
    }
    return { target, index };
  };

  const grab = (e: ReactPointerEvent<HTMLElement>, el: HTMLElement, taskId: string, from: string) => {
    if (e.button !== 0 || dragRef.current) return;
    const rect = el.getBoundingClientRect();
    const sx = e.clientX;
    const sy = e.clientY;
    const offX = sx - rect.left;
    const offY = sy - rect.top;
    const list = from === "unassigned" ? board.unassigned : board.queues[from] ?? [];
    const origin: Over = { target: from, index: list.indexOf(taskId) };
    let started = false;

    const set = (next: DragState) => {
      dragRef.current = next;
      setDrag(next);
    };

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        started = true;
        gx.set(rect.left);
        gy.set(rect.top);
        gw.set(rect.width);
        gh.set(rect.height);
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";
        set({
          taskId,
          from,
          origin,
          over: null,
          phase: "active",
          variant: from === "unassigned" ? "card" : "chip",
          offX,
          offY,
        });
      }
      gx.set(ev.clientX - offX);
      gy.set(ev.clientY - offY);
      const over = hitTest(ev.clientX, ev.clientY);
      const cur = dragRef.current!;
      if (over?.target !== cur.over?.target || over?.index !== cur.over?.index) set({ ...cur, over });
    };

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    const finish = (cancelled: boolean) => {
      cleanup();
      const cur = dragRef.current;
      if (!started || !cur) return;
      const over = cancelled ? null : cur.over;
      // The slot is where the task will land; fly the ghost there while the real item fades in.
      const slot = rootRef.current?.querySelector<HTMLElement>("[data-slot]");
      const r = slot?.getBoundingClientRect();
      set({ ...cur, over, phase: "landing" });
      if (over) commit(taskId, over.target, over.index, true);
      if (r) {
        const land: Transition = { type: "spring", stiffness: 480, damping: 40 };
        animate(gx, r.left, land);
        animate(gy, r.top, land);
        animate(gw, r.width, land);
        animate(gh, r.height, land);
      }
      window.setTimeout(() => {
        dragRef.current = null;
        setDrag(null);
        setLandedId(null);
      }, 360);
    };

    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    const onKeyDown = (ev: KeyboardEvent) => ev.key === "Escape" && finish(true);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKeyDown);
  };

  /* ---- keyboard alternative to dragging ----------------------------------- */

  const keyMove = (e: ReactKeyboardEvent<HTMLElement>, id: string, from: string) => {
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= agents.length) {
      e.preventDefault();
      commit(id, agents[n - 1].id);
    } else if (from !== "unassigned" && (e.key === "Backspace" || e.key === "Delete")) {
      e.preventDefault();
      commit(id, "unassigned");
    }
  };
  const chipHint = `Drag to another agent, or press 1–${agents.length}. Delete returns it to Unassigned.`;

  /* ---- what each list shows right now ------------------------------------- */

  const active = drag?.phase === "active" ? drag : null;
  const slotAt: Over | null = active ? (active.over ?? active.origin) : null;

  const entriesFor = (target: string): Entry[] => {
    const ids = (target === "unassigned" ? board.unassigned : (board.queues[target] ?? [])).filter(
      (id) => id !== active?.taskId,
    );
    const out: Entry[] = ids.map((id) => ({ type: "task", id }));
    if (slotAt?.target === target) out.splice(slotAt.index, 0, { type: "slot" });
    return out;
  };

  /* ---- live preview shown next to the ghost ------------------------------- */

  let preview: Preview | null = null;
  if (active?.over) {
    const task = taskMap[active.taskId];
    const { target, index } = active.over;
    if (target === "unassigned") {
      const src = agentById[active.from];
      if (src) preview = { kind: "unassign", saved: task.minutes * src.ratePerMin };
    } else if (target === active.from) {
      preview = { kind: "reorder", position: index + 1 };
    } else {
      const agent = agentById[target];
      const queued = minutesIn(board.queues[target] ?? []);
      preview = {
        kind: "assign",
        agent: agent.name,
        cost: task.minutes * agent.ratePerMin,
        minutes: task.minutes,
        until: clock(addMinutes(start, queued + task.minutes)),
      };
    }
  }

  const unassignedEntries = entriesFor("unassigned");
  const hoveringUnassigned = active?.over?.target === "unassigned";
  const isDark = !!rootRef.current?.closest(".dark");

  return (
    <section
      ref={rootRef}
      aria-label="Delegate board"
      className={`relative mx-auto w-full max-w-4xl rounded-2xl border border-neutral-200/80 bg-white p-4 text-neutral-900 shadow-[0_1px_2px_rgba(16,24,40,.04),0_16px_40px_-16px_rgba(16,24,40,.14)] dark:border-white/10 dark:bg-neutral-900 dark:text-neutral-100 dark:shadow-[0_1px_2px_rgba(0,0,0,.4),0_20px_48px_-16px_rgba(0,0,0,.7)] sm:p-5 ${className}`}
    >
      {/* Header */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span className="text-blue-500 dark:text-blue-400">
              <Sparkle />
            </span>
            Delegate
          </h2>
          <div className="relative mt-0.5 h-5 overflow-hidden text-[13px] text-neutral-500 dark:text-neutral-400">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.p
                key={auto ? "auto" : "manual"}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={softSpring}
                className="whitespace-nowrap"
              >
                {auto ? "New tasks go to whoever is free first" : "Drag a task onto an agent"}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
        <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-neutral-500 dark:text-neutral-400">
          Auto
          <Switch checked={auto} onChange={setAuto} />
        </label>
      </header>

      {/* Body */}
      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        {/* Unassigned */}
        <section
          data-drop="unassigned"
          aria-label="Unassigned tasks"
          className={`flex flex-col rounded-xl p-3 ring-1 ring-inset transition-[background-color,box-shadow] duration-200 ${
            hoveringUnassigned
              ? "bg-blue-50/70 ring-blue-400/60 dark:bg-blue-400/[0.07] dark:ring-blue-400/40"
              : "bg-neutral-50 ring-neutral-200/70 dark:bg-white/[0.025] dark:ring-white/[0.06]"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Unassigned
              </h3>
              <span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-neutral-200/80 px-1.5 text-[11px] font-semibold text-neutral-600 dark:bg-white/10 dark:text-neutral-300">
                <Swap value={String(board.unassigned.length)} />
              </span>
            </div>
            <button
              type="button"
              onClick={addTask}
              className={`rounded-md px-1.5 py-0.5 text-xs font-medium text-neutral-500 transition-colors hover:bg-neutral-200/70 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-neutral-100 ${focusRing}`}
            >
              + New
            </button>
          </div>

          <div className="relative mt-3 flex flex-1 flex-col gap-2">
            <AnimatePresence mode="popLayout" initial={false} custom={!!active}>
              {unassignedEntries.map((entry) =>
                entry.type === "slot" ? (
                  <Slot key="slot" variant="card" />
                ) : (
                  <TaskCard
                    key={entry.id}
                    task={taskMap[entry.id]}
                    landed={landedId === entry.id}
                    hint={`Drag onto an agent, or press 1–${agents.length}.`}
                    onGrab={(e, el) => grab(e, el, entry.id, "unassigned")}
                    onKey={(e) => keyMove(e, entry.id, "unassigned")}
                  />
                ),
              )}
            </AnimatePresence>
            <AnimatePresence>
              {unassignedEntries.length === 0 && (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.1 } }}
                  transition={softSpring}
                  className="flex min-h-[132px] flex-1 flex-col items-center justify-center gap-2 text-center"
                >
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-600/15 dark:bg-emerald-400/10 dark:text-emerald-300 dark:ring-emerald-400/20">
                    <Svg size={16}>
                      <path d="m3.5 8.5 3 3 6-7" />
                    </Svg>
                  </span>
                  <span className="text-sm text-neutral-500 dark:text-neutral-400">Everything is handed out</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* Agents */}
        <section aria-label="Agents" className="flex min-w-0 flex-col p-1 md:p-0 md:pl-1">
          <div className="flex items-center justify-between gap-2 md:pt-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Agents
            </h3>
            <span className="text-xs text-neutral-500 dark:text-neutral-400">
              <span className="font-semibold text-neutral-800 dark:text-neutral-100">
                <Money value={totalCost} />
              </span>{" "}
              in queues
            </span>
          </div>
          <div className="-mb-1 mt-2 flex flex-col">
            {stats.map(({ agent, until }) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                entries={entriesFor(agent.id)}
                until={until}
                dragging={!!active}
                hovered={active?.over?.target === agent.id}
                instant={!!active}
                landedId={landedId}
                tasks={taskMap}
                hint={chipHint}
                onGrab={grab}
                onKey={keyMove}
              />
            ))}
          </div>
        </section>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {drag && taskMap[drag.taskId] && (
        <DragGhost
          drag={drag}
          task={taskMap[drag.taskId]}
          preview={preview}
          x={gx}
          y={gy}
          w={gw}
          h={gh}
          dark={isDark}
        />
      )}
    </section>
  );
}
