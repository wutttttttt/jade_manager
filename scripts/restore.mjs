import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const source = resolve(process.argv[2] ?? '')
const databaseUrl = process.env.RESTORE_DATABASE_URL
if (!process.argv[2] || !databaseUrl) throw new Error('需要备份目录及 RESTORE_DATABASE_URL')
const root = process.cwd()
const backupsDirectory = resolve(root, 'backups')
const backupsRoot = await realpath(backupsDirectory)
if (backupsRoot !== backupsDirectory) throw new Error('backups 目录不能是符号链接')
const realSource = await realpath(source)
if (!realSource.startsWith(`${backupsRoot}/`)) throw new Error('只能从项目 backups 目录恢复')
const database = new URL(databaseUrl)
const databaseName = decodeURIComponent(database.pathname.slice(1))
if (!['postgres:', 'postgresql:'].includes(database.protocol)) throw new Error('RESTORE_DATABASE_URL 必须是 PostgreSQL URL')
if (!databaseName || process.env.RESTORE_CONFIRM !== databaseName) {
  throw new Error(`设置 RESTORE_CONFIRM=${databaseName} 以确认清理目标数据库`)
}
if (!process.env.DATABASE_URL) throw new Error('缺少 DATABASE_URL，无法确认目标不是当前数据库')
const currentDatabaseName = decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1))
if (databaseName === currentDatabaseName) throw new Error('拒绝恢复到与当前库同名的数据库')
const postgresBin = process.env.POSTGRES_BIN ?? '/opt/homebrew/opt/postgresql@16/bin'
const mediaRoot = resolve(process.env.RESTORE_MEDIA_ROOT ?? './var/media-restore')
if (!mediaRoot.startsWith(`${root}/`)) throw new Error('恢复媒体目录必须在项目内')
const currentMediaRoot = resolve(process.env.MEDIA_ROOT ?? './var/media')
if (mediaRoot === currentMediaRoot) throw new Error('拒绝恢复到当前媒体目录')
for (const name of ['manifest.json', 'database.dump', 'media.tar.gz']) {
  const file = await lstat(resolve(realSource, name))
  if (!file.isFile()) throw new Error('备份文件必须是普通文件')
  if (name === 'manifest.json' && file.size > 64 * 1024) throw new Error('备份清单过大')
}
const databaseFile = resolve(realSource, 'database.dump')
const mediaFile = resolve(realSource, 'media.tar.gz')
const manifest = JSON.parse(await readFile(resolve(realSource, 'manifest.json'), 'utf8'))
if (manifest?.version !== 1 || !manifest.files
  || ['database.dump', 'media.tar.gz'].some((name) => !/^[0-9a-f]{64}$/.test(manifest.files[name]))) {
  throw new Error('备份清单格式或版本不支持')
}
const checksum = async (file) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}
if (await checksum(databaseFile) !== manifest.files['database.dump']
  || await checksum(mediaFile) !== manifest.files['media.tar.gz']) throw new Error('备份校验和不匹配')
const mediaEntries = execFileSync('tar', ['-tzf', mediaFile], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
if (mediaEntries.some((entry) => entry.startsWith('/') || entry.split('/').includes('..'))) {
  throw new Error('媒体备份含不安全路径')
}
const mediaDetails = execFileSync('tar', ['-tvzf', mediaFile], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
if (mediaDetails.some((entry) => /^[lh]/.test(entry))) throw new Error('媒体备份不能包含链接')
if (mediaDetails.some((entry) => !/^[-d]/.test(entry))) throw new Error('媒体备份只能包含普通文件和目录')

const pgEnv = { ...process.env,
  PGHOST: database.searchParams.get('host') ?? database.hostname,
  PGPORT: database.port || '5432',
  PGUSER: decodeURIComponent(database.username),
  PGPASSWORD: decodeURIComponent(database.password),
  PGDATABASE: databaseName,
}

const realRoot = await realpath(root)
const realMediaParent = await realpath(dirname(mediaRoot))
if (realMediaParent !== realRoot && !realMediaParent.startsWith(`${realRoot}/`)) {
  throw new Error('恢复媒体目录不能经符号链接逃出项目')
}
await mkdir(mediaRoot, { recursive: true })
const realMediaRoot = await realpath(mediaRoot)
if (!realMediaRoot.startsWith(`${realRoot}/`)) throw new Error('恢复媒体目录不能经符号链接逃出项目')
const realCurrentMediaRoot = await realpath(currentMediaRoot).catch((error) => {
  if (error.code === 'ENOENT') return null
  throw error
})
if (realMediaRoot === realCurrentMediaRoot) throw new Error('拒绝恢复到当前媒体目录')
if ((await readdir(realMediaRoot)).length) throw new Error('恢复媒体目录必须为空')
const mediaMode = (await stat(realMediaRoot)).mode & 0o777
const stagedMedia = await mkdtemp(resolve(dirname(realMediaRoot), '.jade-media-restore-'))
try {
  execFileSync('tar', ['-xzf', mediaFile, '-C', stagedMedia], {
    stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  await chmod(stagedMedia, mediaMode)
  execFileSync(resolve(postgresBin, 'pg_restore'), [
    '--clean', '--if-exists', '--single-transaction', '--no-owner', '--no-privileges',
    '--dbname', databaseName, databaseFile,
  ], { stdio: 'inherit', env: pgEnv })
  await rename(stagedMedia, realMediaRoot)
} catch (error) {
  await rm(stagedMedia, { recursive: true, force: true })
  throw error
}
console.log(`restore: database=${databaseName} media=${realMediaRoot}`)
