import type { WorkerRunInput } from './worker-types.js'

export function effectiveWorkerPrompt(input: WorkerRunInput): string {
  if (input.continuation?.kind !== 'handoff' || !input.continuation.handoff) return input.prompt
  const handoff = input.continuation.handoff
  const files = handoff.touchedFiles.length
    ? handoff.touchedFiles.map((file) => `- ${file.status}: ${file.path}`).join('\n')
    : '- None recorded'
  const limitations = handoff.knownLimitationsOrErrors.length
    ? handoff.knownLimitationsOrErrors.map((item) => `- ${item}`).join('\n')
    : '- None recorded'
  return `Continue this logical task in a NEW provider session using the saved handoff below. Do not claim to remember the previous conversation, and do not repeat completed work unless verification requires it.

## Saved handoff

Original objective: ${handoff.objective}

Previous result summary:
${handoff.summaryOfWork}

Previously touched files:
${files}

Known limitations or errors:
${limitations}

Recommended next step: ${handoff.recommendedNextStep ?? 'Follow the new instruction.'}

## New follow-up instruction

${input.prompt}`
}
