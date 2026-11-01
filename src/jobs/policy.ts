/** Jev's active automatic-application gate, shared by execution and diagnostics. */
export const JEV_MINIMUM_CONFIDENCE = 0.90;
/** Legacy Claude threshold for historical decision display; not an active gate. */
export const CLAUDE_MINIMUM_CONFIDENCE = 0.95;

/** Current best-fit review policy; the older confidence gate is historical metadata. */
export const CLAUDE_REVIEW_POLICY = "best-fit-v2";
export const UNCERTAIN_LABEL = "Uncertain";
