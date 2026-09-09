import assert from 'node:assert/strict'
import { test } from 'node:test'
import dashboardWorkers from '../extensions/dashboard-workers.js'

test('dashboardWorkers registers dashboard_delegate_worker and dashboard_get_worker_task when token is present', () => {
  process.env.PI_DASHBOARD_WORKER_INTERNAL_TOKEN = 'mock-token'
  const tools: Array<{ name: string; label: string; description: string }> = []
  const mockPi = {
    registerTool(tool: any) {
      tools.push(tool)
    },
  }

  dashboardWorkers(mockPi as any)

  assert.equal(tools.length, 2)
  assert.equal(tools[0].name, 'dashboard_delegate_worker')
  assert.equal(tools[1].name, 'dashboard_get_worker_task')
})

test('dashboardWorkers does nothing when token is empty', () => {
  process.env.PI_DASHBOARD_WORKER_INTERNAL_TOKEN = ''
  const tools: any[] = []
  const mockPi = {
    registerTool(tool: any) {
      tools.push(tool)
    },
  }

  dashboardWorkers(mockPi as any)

  assert.equal(tools.length, 0)
})
