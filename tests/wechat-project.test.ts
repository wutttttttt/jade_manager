import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('微信构建配置只接受合法 AppID 且不改源码 manifest', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'jade-wechat-project-'))
  const project = join(directory, 'project.config.json')
  context.after(() => rm(directory, { recursive: true, force: true }))
  await mkdir(directory, { recursive: true })
  await writeFile(project, '{"appid":"touristappid","setting":{}}\n')

  const valid = spawnSync(process.execPath, ['scripts/wechat-project.mjs'], { encoding: 'utf8',
    env: { ...process.env, WECHAT_APPID: 'wx0123456789abcdef', WECHAT_PROJECT_CONFIG: project } })
  assert.equal(valid.status, 0, valid.stderr)
  assert.equal(JSON.parse(await readFile(project, 'utf8')).appid, 'wx0123456789abcdef')

  const invalid = spawnSync(process.execPath, ['scripts/wechat-project.mjs'], { encoding: 'utf8',
    env: { ...process.env, WECHAT_APPID: 'touristappid', WECHAT_PROJECT_CONFIG: project } })
  assert.notEqual(invalid.status, 0)
  assert.match(invalid.stderr, /WECHAT_APPID/)
})
