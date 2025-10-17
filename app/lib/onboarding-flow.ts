// app/lib/onboarding-flow.ts
export const NEXT_STEP_API = "/api/next-user-step";

/** The canonical steps for the onboarding timeline */
export const STEPS: { key: "onboarding" | "link-services" | "welcome"; label: string; routes: string[] }[] = [
  {
    key: "onboarding",
    label: "Set up account",
    routes: ["/onboarding-flow/onboarding"],
  },
  {
    key: "link-services",
    label: "Link services",
    // include both Google + Xero routes as part of the same step
    routes: ["/onboarding-flow/link-google", "/onboarding-flow/link-xero"],
  },
  {
    key: "welcome",
    label: "Review overview",
    routes: ["/onboarding-flow/welcome", "/onboarding-flow/welcome/"], // add variations if needed
  },
];

/** Given a path, return the index (0-based) of the step that owns it. Defaults to 0. */
export function inferStepIndexFromPath(pathname: string | null | undefined): number {
  if (!pathname) return 0;
  const idx = STEPS.findIndex((s) => s.routes.some((r) => pathname.startsWith(r)));
  return idx >= 0 ? idx : 0;
}
