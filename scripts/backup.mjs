import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

if (!process.env.DATABASE_URL) throw new Error('缺少 DATABASE_URL')
if (process.env.BACKUP_CONFIRM_OFFLINE !== '1') {
  throw new Error('先停止 API，再设置 BACKUP_CONFIRM_OFFLINE=1 执行联合备份')
}
const root = process.cwd()
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const destination = resolve(process.argv[2] ?? `backups/${stamp}`)
const backupsRoot = resolve(root, 'backups')
if (dirname(destination) !== backupsRoot) throw new Error('备份只能写入项目 backups 的直接子目录')
const postgresBin = process.env.POSTGRES_BIN ?? '/opt/homebrew/opt/postgresql@16/bin'
const mediaRoot = resolve(process.env.MEDIA_ROOT ?? './var/media')
const databaseFile = resolve(destination, 'database.dump')
const mediaFile = resolve(destination, 'media.tar.gz')
const database = new URL(process.env.DATABASE_URL)
if (!['postgres:', 'postgresql:'].includes(database.protocol) || !database.pathname.slice(1)) {
  throw new Error('DATABASE_URL 必须是带数据库名的 PostgreSQL URL')
}

await mkdir(backupsRoot, { recursive: true })
if (await realpath(backupsRoot) !== backupsRoot) throw new Error('backups 目录不能是符号链接')
const realMediaRoot = await realpath(mediaRoot)
if (!realMediaRoot.startsWith(`${await realpath(root)}/`)) throw new Error('媒体目录不能经符号链接逃出项目')
if (destination.startsWith(`${realMediaRoot}/`)) throw new Error('备份目标不能位于媒体目录内')
await mkdir(destination, { recursive: false })
try {
  const pgEnv = { ...process.env,
    PGHOST: database.searchParams.get('host') ?? database.hostname,
    PGPORT: database.port || '5432',
    PGUSER: decodeURIComponent(database.username),
    PGPASSWORD: decodeURIComponent(database.password),
    PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
  }
  execFileSync(resolve(postgresBin, 'pg_dump'), [
    '--format=custom', '--no-owner', '--no-privileges', '--file', databaseFile,
  ], { stdio: 'inherit', env: pgEnv })
  execFileSync('tar', ['-czf', mediaFile, '--exclude=._*', '--exclude=.DS_Store', '--exclude=*.part',
    '-C', realMediaRoot, '.'], {
    stdio: 'inherit', env: { ...process.env, COPYFILE_DISABLE: '1' },
  })
  const mediaDetails = execFileSync('tar', ['-tvzf', mediaFile], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  if (mediaDetails.some((entry) => !/^[-d]/.test(entry))) {
    throw new Error('媒体目录只能包含普通文件和目录')
  }

  const checksum = async (file) => {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    return hash.digest('hex')
  }
  await writeFile(resolve(destination, 'manifest.json'), JSON.stringify({
    version: 1,
    createdAt: new Date().toISOString(),
    files: { 'database.dump': await checksum(databaseFile), 'media.tar.gz': await checksum(mediaFile) },
  }, null, 2) + '\n')
  console.log(`backup: ${destination}`)
} catch (error) {
  await rm(destination, { recursive: true, force: true })
  throw error
}
