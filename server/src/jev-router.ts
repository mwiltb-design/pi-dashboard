export type JevProfileId =
  | 'conversation-planning'
  | 'detailed-planning'
  | 'implementation-research'
  | 'hard-repair'
  | 'repair-light'
  | 'repair-deep'
  | 'economy-repair'

export interface JevProfile {
  id: JevProfileId
  providerId: string
  model?: { provider: string; id: string }
  effort?: string
  description: string
}

export const JEV_PROFILES: readonly JevProfile[] = [
  { id: 'conversation-planning', providerId: 'sub-pi', model: { provider: 'openai', id: 'gpt-5.6-luna' }, description: 'Conversation, scope, high-level plans, simple file work, and tests.' },
  { id: 'detailed-planning', providerId: 'sub-pi', model: { provider: 'openai', id: 'gpt-5.6-sol' }, description: 'Detailed task decomposition, implementation steps, and test design.' },
  { id: 'implementation-research', providerId: 'antigravity-cli', model: { provider: 'antigravity', id: 'gemini-3.8-flash' }, effort: 'high', description: 'Repository analysis, web research, and bulk implementation after an approved plan.' },
  { id: 'hard-repair', providerId: 'sub-pi', model: { provider: 'openai', id: 'gpt-6-astra' }, description: 'Difficult repair after repeated implementation failures.' },
  { id: 'repair-light', providerId: 'sub-pi', model: { provider: 'openai', id: 'gpt-5.6-luna' }, description: 'Small verification-driven fixes.' },
  { id: 'repair-deep', providerId: 'antigravity-cli', model: { provider: 'antigravity', id: 'gemini-3.7-flash' }, effort: 'high', description: 'Larger or architectural repair work.' },
  { id: 'economy-repair', providerId: 'sub-pi', model: { provider: 'openrouter', id: 'nvidia/nemotron-3-ultra-550b-a55b:free' }, description: 'Optional low-cost repair after tool-use benchmarking.' },
]

export interface JevRoutingContext {
  phase: 'planning' | 'detailed-planning' | 'implementation' | 'repair' | 'verification'
  objective: string
  planSummary?: string
  failureCount: number
  failureType?: string
  verificationSummary?: string
  explicitProfile?: JevProfileId
  allowedProfileIds?: JevProfileId[]
}

export interface JevDecision {
  profile: JevProfileId
  confidence?: number
  probabilities?: Record<string, number>
  model?: string
  fallback?: string
  latencyMs?: number
}

const PHASE_PROFILES: Record<JevRoutingContext['phase'], JevProfileId[]> = {
  planning: ['conversation-planning', 'detailed-planning'],
  'detailed-planning': ['detailed-planning'],
  implementation: ['implementation-research'],
  repair: ['repair-light', 'repair-deep', 'hard-repair', 'economy-repair'],
  verification: ['repair-light', 'repair-deep'],
}

export function eligibleJevProfiles(context: JevRoutingContext): JevProfile[] {
  const phaseAllowed = new Set(PHASE_PROFILES[context.phase])
  if (context.failureCount >= 2 && context.phase === 'repair') {
    phaseAllowed.delete('repair-light')
  }
  const requested = context.allowedProfileIds ? new Set(context.allowedProfileIds) : undefined
  return JEV_PROFILES.filter((profile) => phaseAllowed.has(profile.id) && (!requested || requested.has(profile.id)))
}

export function deterministicJevFallback(context: JevRoutingContext, candidates = eligibleJevProfiles(context)): JevDecision {
  if (context.explicitProfile && candidates.some((candidate) => candidate.id === context.explicitProfile)) {
    return { profile: context.explicitProfile, confidence: 1, fallback: 'explicit-profile' }
  }
  const fallback = candidates[0]
  if (!fallback) throw new Error(`No eligible Jev routing profile for phase '${context.phase}'`)
  return { profile: fallback.id, fallback: 'deterministic-policy' }
}

export class JevRouter {
  constructor(
    private readonly options: {
      apiKey?: string
      model?: string
      timeoutMs?: number
      fetchImpl?: typeof fetch
    } = {},
  ) {}

  async decide(context: JevRoutingContext): Promise<JevDecision> {
    const candidates = eligibleJevProfiles(context)
    const fallback = deterministicJevFallback(context, candidates)
    if (context.explicitProfile || !this.options.apiKey) return fallback

    const started = Date.now()
    const fetchImpl = this.options.fetchImpl ?? fetch
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 1500)
    try {
      const response = await fetchImpl('https://openrouter.ai/api/alpha/decisions', {
        method: 'POST',
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.options.model ?? 'typesafe/jev-1.13',
          state: {
            phase: context.phase,
            objective: context.objective.slice(0, 6000),
            planSummary: context.planSummary?.slice(0, 4000),
            failureCount: context.failureCount,
            failureType: context.failureType?.slice(0, 500),
            verificationSummary: context.verificationSummary?.slice(0, 3000),
          },
          questions: {
            profile: {
              type: 'choice',
              criteria: Object.fromEntries(candidates.map((candidate) => [candidate.id, candidate.description])),
              instructions: 'Choose the single best eligible workflow profile. Do not choose a profile not listed in the criteria.',
            },
          },
        }),
      })
      if (!response.ok) throw new Error(`Jev request failed with HTTP ${response.status}`)
      const payload = await response.json() as { model?: string; answers?: Record<string, unknown> }
      const answer = payload.answers?.profile as { choice?: unknown; confidence?: unknown; probabilities?: unknown } | undefined
      const choice = typeof answer?.choice === 'string' ? answer.choice as JevProfileId : undefined
      if (!choice || !candidates.some((candidate) => candidate.id === choice)) throw new Error('Jev returned an unknown or missing workflow profile')
      return {
        profile: choice,
        ...(typeof answer?.confidence === 'number' ? { confidence: answer.confidence } : {}),
        ...(answer?.probabilities && typeof answer.probabilities === 'object' ? { probabilities: answer.probabilities as Record<string, number> } : {}),
        ...(payload.model ? { model: payload.model } : {}),
        latencyMs: Date.now() - started,
      }
    } catch (error) {
      return { ...fallback, fallback: error instanceof Error ? `jev-error:${error.message}` : 'jev-error:unknown', latencyMs: Date.now() - started }
    } finally {
      clearTimeout(timeout)
    }
  }
}
