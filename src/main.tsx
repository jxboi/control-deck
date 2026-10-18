import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import DelegateBoard from "./DelegateBoard";
import "./index.css";

function Demo() {
  const [dark, setDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return (
    <div className="min-h-screen bg-neutral-100 px-4 py-10 transition-colors dark:bg-neutral-950 sm:py-16">
      <div className="mx-auto mb-4 flex max-w-4xl justify-end">
        <button
          onClick={() => setDark((d) => !d)}
          className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600 shadow-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          {dark ? "☾ Dark" : "☀ Light"}
        </button>
      </div>
      <DelegateBoard />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
