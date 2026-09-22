import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JevRouter, deterministicJevFallback, eligibleJevProfiles } from '../src/jev-router.js'

test('Jev profiles are constrained by workflow phase and failure count', () => {
  assert.deepEqual(eligibleJevProfiles({ phase: 'implementation', objective: 'build', failureCount: 0 }).map((profile) => profile.id), ['implementation-research'])
  assert.ok(!eligibleJevProfiles({ phase: 'repair', objective: 'fix', failureCount: 2 }).some((profile) => profile.id === 'repair-light'))
})

test('Jev fallback honors an eligible explicit profile', () => {
  const decision = deterministicJevFallback({ phase: 'repair', objective: 'fix', failureCount: 1, explicitProfile: 'repair-deep' })
  assert.equal(decision.profile, 'repair-deep')
  assert.equal(decision.fallback, 'explicit-profile')
})

test('Jev router safely falls back when disabled or unavailable', async () => {
  const disabled = await new JevRouter().decide({ phase: 'implementation', objective: 'build', failureCount: 0 })
  assert.equal(disabled.profile, 'implementation-research')
  assert.equal(disabled.fallback, 'deterministic-policy')

  const unavailable = await new JevRouter({ apiKey: 'test-key', fetchImpl: async () => new Response('{}', { status: 503 }) }).decide({ phase: 'implementation', objective: 'build', failureCount: 0 })
  assert.equal(unavailable.profile, 'implementation-research')
  assert.match(unavailable.fallback ?? '', /^jev-error:/)
})

test('Jev router rejects a profile outside the eligible candidate set', async () => {
  const router = new JevRouter({
    apiKey: 'test-key',
    fetchImpl: async () => new Response(JSON.stringify({ answers: { profile: { choice: 'hard-repair' } } }), { status: 200 }),
  })
  const decision = await router.decide({ phase: 'implementation', objective: 'build', failureCount: 0 })
  assert.equal(decision.profile, 'implementation-research')
  assert.match(decision.fallback ?? '', /unknown|missing/i)
})
