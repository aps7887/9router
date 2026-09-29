import initializeApp from "./initializeApp.js";

// Skip during Next.js build/prerender — bootstrap would download cloudflared, init DNS, etc.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build"
  || process.env.NEXT_PHASE === "phase-export"
  || process.env.NEXT_PHASE === "phase-static";

// Skip on Vercel serverless — tunnel/MITM/watchdog/background processes are not
// available in serverless functions. The app runs in stateless API mode.
const isVercel = process.env.VERCEL === "1";

// Server-only singleton: guard via global so HMR / re-imports don't double-init
if (typeof window === "undefined" && !isBuildPhase && !isVercel && !global.__appBootstrapped) {
  global.__appBootstrapped = true;
  initializeApp().catch((e) => console.error("[Bootstrap] init failed:", e.message));
}
