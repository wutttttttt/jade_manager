import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, appendFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink,
  writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))

test('联合备份恢复校验数据库与媒体且拒绝危险目标', async (context) => {
  const suffix = `${process.pid}-${Date.now()}`
  const fakeBin = await mkdtemp(join(tmpdir(), 'jade-pg-bin-'))
  const mediaSource = join(root, 'var', `media-backup-test-${suffix}`)
  const mediaRestore = join(root, 'var', `media-restore-test-${suffix}`)
  const mediaFailedDatabaseTarget = join(root, 'var', `media-db-failed-test-${suffix}`)
  const mediaCurrentTarget = join(root, 'var', `media-current-test-${suffix}`)
  const mediaCurrentAlias = join(root, 'var', `media-current-alias-test-${suffix}`)
  const mediaAbsentSourceTarget = join(root, 'var', `media-absent-source-test-${suffix}`)
  const mediaUnsafeTarget = join(root, 'var', `media-unsafe-test-${suffix}`)
  const mediaTamperTarget = join(root, 'var', `media-tamper-test-${suffix}`)
  const mediaEscapeLink = join(root, 'var', `media-escape-test-${suffix}`)
  const linkedProjectRoot = join(root, 'var', `restore-root-test-${suffix}`)
  const backupName = `test-${suffix}`
  const linkedBackupName = `test-linked-${suffix}`
  const failedBackupName = `test-failed-${suffix}`
  const backupDir = join(root, 'backups', backupName)
  const linkedBackupDir = join(root, 'backups', linkedBackupName)
  const failedBackupDir = join(root, 'backups', failedBackupName)
  const restoreLog = join(fakeBin, 'restore.log')
  const inspectLog = join(fakeBin, 'inspect.log')
  context.after(async () => {
    await unlink(mediaEscapeLink).catch(() => undefined)
    await unlink(mediaCurrentAlias).catch(() => undefined)
    await Promise.all([fakeBin, mediaSource, mediaRestore, mediaFailedDatabaseTarget, mediaCurrentTarget,
      mediaAbsentSourceTarget, mediaUnsafeTarget, mediaTamperTarget, linkedProjectRoot,
      backupDir, linkedBackupDir, failedBackupDir]
      .map((path) => rm(path, { recursive: true, force: true })))
  })

  await mkdir(mediaSource, { recursive: true })
  await writeFile(join(mediaSource, 'asset.bin'), 'synthetic media\n')
  await writeFile(join(mediaSource, 'abandoned.part'), 'incomplete upload\n')
  await writeFile(join(fakeBin, 'pg_dump'), `#!/bin/sh
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '--file' ]; then output="$2"; shift 2; else shift; fi
done
[ -n "$output" ] || exit 2
printf 'synthetic database dump\n' > "$output"
`)
  await writeFile(join(fakeBin, 'pg_restore'), `#!/bin/sh
printf '%s\n' "$@" > "$PG_RESTORE_LOG"
`)
  await writeFile(join(fakeBin, 'psql'), `#!/bin/sh
printf '%s\n' "$@" > "$PG_INSPECT_LOG"
printf '0\n'
`)
  await Promise.all(['pg_dump', 'pg_restore', 'psql'].map((name) => chmod(join(fakeBin, name), 0o755)))

  const baseEnv = { ...process.env, POSTGRES_BIN: fakeBin, BACKUP_CONFIRM_OFFLINE: '1',
    DATABASE_URL: 'postgres://jade:jade@127.0.0.1:5432/jade_manager', MEDIA_ROOT: mediaSource }
  const onlineBackup = spawnSync(process.execPath, ['scripts/backup.mjs', `backups/${failedBackupName}`], {
    cwd: root, env: { ...baseEnv, BACKUP_CONFIRM_OFFLINE: '' }, encoding: 'utf8',
  })
  assert.notEqual(onlineBackup.status, 0)
  assert.match(onlineBackup.stderr, /先停止 API/)
  await assert.rejects(access(failedBackupDir), { code: 'ENOENT' })

  const overlappingBackup = spawnSync(process.execPath, ['scripts/backup.mjs', `backups/${failedBackupName}`], {
    cwd: root, env: { ...baseEnv, MEDIA_ROOT: join(root, 'backups') }, encoding: 'utf8',
  })
  assert.notEqual(overlappingBackup.status, 0)
  assert.match(overlappingBackup.stderr, /备份目标不能位于媒体目录内/)
  await assert.rejects(access(failedBackupDir), { code: 'ENOENT' })

  const linkedSource = join(mediaSource, 'linked.bin')
  await symlink('asset.bin', linkedSource)
  const unsafeSourceBackup = spawnSync(process.execPath, ['scripts/backup.mjs', `backups/${failedBackupName}`], {
    cwd: root, env: baseEnv, encoding: 'utf8',
  })
  assert.notEqual(unsafeSourceBackup.status, 0)
  assert.match(unsafeSourceBackup.stderr, /媒体目录只能包含普通文件和目录/)
  await assert.rejects(access(failedBackupDir), { code: 'ENOENT' })
  await unlink(linkedSource)

  const backup = spawnSync(process.execPath, ['scripts/backup.mjs', `backups/${backupName}`], {
    cwd: root, env: baseEnv, encoding: 'utf8',
  })
  assert.equal(backup.status, 0, backup.stderr)
  const manifestPath = join(backupDir, 'manifest.json')
  const manifestSource = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(manifestSource)
  for (const name of ['database.dump', 'media.tar.gz']) {
    const digest = createHash('sha256').update(await readFile(join(backupDir, name))).digest('hex')
    assert.equal(manifest.files[name], digest)
  }

  const restoreEnv = { ...baseEnv, PG_RESTORE_LOG: restoreLog, PG_INSPECT_LOG: inspectLog,
    RESTORE_DATABASE_URL: 'postgres://jade:jade@127.0.0.1:5432/jade_manager_restore_test',
    RESTORE_CONFIRM: 'jade_manager_restore_test', RESTORE_MEDIA_ROOT: mediaRestore }
  await mkdir(linkedProjectRoot)
  await symlink(join(root, 'backups'), join(linkedProjectRoot, 'backups'))
  const linkedBackupsRoot = spawnSync(process.execPath, [join(root, 'scripts/restore.mjs'), `backups/${backupName}`], {
    cwd: linkedProjectRoot, env: restoreEnv, encoding: 'utf8',
  })
  assert.notEqual(linkedBackupsRoot.status, 0)
  assert.match(linkedBackupsRoot.stderr, /backups 目录不能是符号链接/)

  await mkdir(linkedBackupDir)
  await symlink(manifestPath, join(linkedBackupDir, 'manifest.json'))
  const linkedBackupRestore = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${linkedBackupName}`], {
    cwd: root, env: restoreEnv, encoding: 'utf8',
  })
  assert.notEqual(linkedBackupRestore.status, 0)
  assert.match(linkedBackupRestore.stderr, /备份文件必须是普通文件/)
  await assert.rejects(access(restoreLog), { code: 'ENOENT' })
  await unlink(join(linkedBackupDir, 'manifest.json'))
  await writeFile(join(linkedBackupDir, 'manifest.json'), ' '.repeat(64 * 1024 + 1))
  const oversizedManifest = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${linkedBackupName}`], {
    cwd: root, env: restoreEnv, encoding: 'utf8',
  })
  assert.notEqual(oversizedManifest.status, 0)
  assert.match(oversizedManifest.stderr, /备份清单过大/)
  await assert.rejects(access(restoreLog), { code: 'ENOENT' })

  const restore = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: restoreEnv, encoding: 'utf8',
  })
  assert.equal(restore.status, 0, restore.stderr)
  assert.equal(await readFile(join(mediaRestore, 'asset.bin'), 'utf8'), 'synthetic media\n')
  await assert.rejects(access(join(mediaRestore, 'abandoned.part')), { code: 'ENOENT' })
  const restoreArguments = await readFile(restoreLog, 'utf8')
  assert.doesNotMatch(restoreArguments, /--clean/)
  assert.match(restoreArguments, /--single-transaction/)
  assert.match(restoreArguments, /--exit-on-error/)
  assert.match(restoreArguments, /jade_manager_restore_test/)
  assert.match(await readFile(inspectLog, 'utf8'), /--dbname\njade_manager_restore_test/)

  await writeFile(join(fakeBin, 'psql'), '#!/bin/sh\nprintf "1\\n"\n')
  await unlink(restoreLog)
  const nonemptyDatabase = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, RESTORE_MEDIA_ROOT: mediaUnsafeTarget }, encoding: 'utf8',
  })
  assert.notEqual(nonemptyDatabase.status, 0)
  assert.match(nonemptyDatabase.stderr, /恢复目标数据库必须为空/)
  await assert.rejects(access(restoreLog), { code: 'ENOENT' })
  await writeFile(join(fakeBin, 'psql'), '#!/bin/sh\nprintf "0\\n"\n')

  await mkdir(mediaCurrentTarget)
  const currentMediaRestore = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, MEDIA_ROOT: mediaCurrentTarget, RESTORE_MEDIA_ROOT: mediaCurrentTarget },
    encoding: 'utf8',
  })
  assert.notEqual(currentMediaRestore.status, 0)
  assert.match(currentMediaRestore.stderr, /拒绝恢复到当前媒体目录/)
  assert.deepEqual(await readdir(mediaCurrentTarget), [])
  await assert.rejects(access(restoreLog), { code: 'ENOENT' })

  const nestedTarget = join(mediaSource, 'restore-child')
  const nestedMediaRestore = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, RESTORE_MEDIA_ROOT: nestedTarget }, encoding: 'utf8',
  })
  assert.notEqual(nestedMediaRestore.status, 0)
  assert.match(nestedMediaRestore.stderr, /恢复媒体目录不能与当前媒体目录重叠/)
  await assert.rejects(access(nestedTarget), { code: 'ENOENT' })
  await assert.rejects(access(restoreLog), { code: 'ENOENT' })

  await symlink(mediaCurrentTarget, mediaCurrentAlias)
  const aliasedCurrentMediaRestore = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, MEDIA_ROOT: mediaCurrentTarget, RESTORE_MEDIA_ROOT: mediaCurrentAlias },
    encoding: 'utf8',
  })
  assert.notEqual(aliasedCurrentMediaRestore.status, 0)
  assert.match(aliasedCurrentMediaRestore.stderr, /恢复媒体目录不能与当前媒体目录重叠/)
  assert.deepEqual(await readdir(mediaCurrentTarget), [])
  await assert.rejects(access(restoreLog), { code: 'ENOENT' })

  const absentSourceMediaRestore = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, MEDIA_ROOT: join(root, 'var', `media-missing-test-${suffix}`),
      RESTORE_MEDIA_ROOT: mediaAbsentSourceTarget }, encoding: 'utf8',
  })
  assert.equal(absentSourceMediaRestore.status, 0, absentSourceMediaRestore.stderr)
  assert.equal(await readFile(join(mediaAbsentSourceTarget, 'asset.bin'), 'utf8'), 'synthetic media\n')

  await writeFile(join(fakeBin, 'pg_restore'), `#!/bin/sh
printf '%s\n' "$@" > "$PG_RESTORE_LOG"
exit 7
`)
  const stagedBefore = (await readdir(join(root, 'var'))).filter((name) => name.startsWith('.jade-media-restore-'))
  const failedDatabaseRestore = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, RESTORE_MEDIA_ROOT: mediaFailedDatabaseTarget }, encoding: 'utf8',
  })
  assert.notEqual(failedDatabaseRestore.status, 0)
  assert.match(await readFile(restoreLog, 'utf8'), /--single-transaction/)
  assert.deepEqual(await readdir(mediaFailedDatabaseTarget), [])
  assert.deepEqual((await readdir(join(root, 'var'))).filter((name) => name.startsWith('.jade-media-restore-')),
    stagedBefore)

  await symlink(fakeBin, mediaEscapeLink)
  const escapedTarget = join(fakeBin, 'must-not-create')
  const escapedRestore = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, RESTORE_MEDIA_ROOT: join(mediaEscapeLink, 'must-not-create') },
    encoding: 'utf8',
  })
  assert.notEqual(escapedRestore.status, 0)
  assert.match(escapedRestore.stderr, /恢复媒体目录不能经符号链接逃出项目/)
  await assert.rejects(access(escapedTarget), { code: 'ENOENT' })
  await unlink(mediaEscapeLink)

  const unknownCurrentDatabase = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, DATABASE_URL: '', RESTORE_MEDIA_ROOT: mediaUnsafeTarget }, encoding: 'utf8',
  })
  assert.notEqual(unknownCurrentDatabase.status, 0)
  assert.match(unknownCurrentDatabase.stderr, /缺少 DATABASE_URL/)

  const sameDatabase = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv,
      RESTORE_DATABASE_URL: 'postgres://jade:jade@127.0.0.1:5432/jade_manager', RESTORE_CONFIRM: 'jade_manager' },
    encoding: 'utf8',
  })
  assert.notEqual(sameDatabase.status, 0)
  assert.match(sameDatabase.stderr, /拒绝恢复到与当前库同名的数据库/)

  await writeFile(join(fakeBin, 'tar'), `#!/bin/sh
if [ "$1" = '-tzf' ]; then printf '../escape\n'; exit 0; fi
exit 2
`)
  await chmod(join(fakeBin, 'tar'), 0o755)
  const unsafeArchive = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, RESTORE_MEDIA_ROOT: mediaUnsafeTarget,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}` }, encoding: 'utf8',
  })
  assert.notEqual(unsafeArchive.status, 0)
  assert.match(unsafeArchive.stderr, /媒体备份含不安全路径/)

  await writeFile(join(fakeBin, 'tar'), `#!/bin/sh
if [ "$1" = '-tzf' ]; then printf './link\n'; exit 0; fi
if [ "$1" = '-tvzf' ]; then printf 'lrwxr-xr-x  0 user group 0 Jan 1 00:00 ./link -> ../../escape\n'; exit 0; fi
exit 2
`)
  const linkedArchive = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, RESTORE_MEDIA_ROOT: mediaUnsafeTarget,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}` }, encoding: 'utf8',
  })
  assert.notEqual(linkedArchive.status, 0)
  assert.match(linkedArchive.stderr, /媒体备份不能包含链接/)

  await writeFile(join(fakeBin, 'tar'), `#!/bin/sh
if [ "$1" = '-tzf' ]; then printf './pipe\n'; exit 0; fi
if [ "$1" = '-tvzf' ]; then printf 'prw-r--r--  0 user group 0 Jan 1 00:00 ./pipe\n'; exit 0; fi
exit 2
`)
  const specialArchive = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, RESTORE_MEDIA_ROOT: mediaUnsafeTarget,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}` }, encoding: 'utf8',
  })
  assert.notEqual(specialArchive.status, 0)
  assert.match(specialArchive.stderr, /媒体备份只能包含普通文件和目录/)

  await writeFile(join(fakeBin, 'tar'), `#!/bin/sh
if [ "$1" = '-tzf' ]; then printf './asset.bin\n'; exit 0; fi
if [ "$1" = '-tvzf' ]; then printf '%s\n' '-rw-r--r--  0 user group 16 Jan 1 00:00 ./asset.bin'; exit 0; fi
if [ "$1" = '-xzf' ]; then exit 7; fi
exit 2
`)
  await unlink(restoreLog)
  const failedExtraction = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, RESTORE_MEDIA_ROOT: mediaUnsafeTarget,
      PATH: `${fakeBin}:${process.env.PATH ?? ''}` }, encoding: 'utf8',
  })
  assert.notEqual(failedExtraction.status, 0)
  await assert.rejects(access(restoreLog), { code: 'ENOENT' })
  assert.deepEqual(await readdir(mediaUnsafeTarget), [])

  await writeFile(manifestPath, JSON.stringify({ ...manifest, version: 2 }))
  const unsupportedManifest = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, RESTORE_MEDIA_ROOT: mediaTamperTarget }, encoding: 'utf8',
  })
  assert.notEqual(unsupportedManifest.status, 0)
  assert.match(unsupportedManifest.stderr, /备份清单格式或版本不支持/)
  await writeFile(manifestPath, manifestSource)

  await appendFile(join(backupDir, 'database.dump'), 'tampered')
  const tampered = spawnSync(process.execPath, ['scripts/restore.mjs', `backups/${backupName}`], {
    cwd: root, env: { ...restoreEnv, RESTORE_MEDIA_ROOT: mediaTamperTarget }, encoding: 'utf8',
  })
  assert.notEqual(tampered.status, 0)
  assert.match(tampered.stderr, /备份校验和不匹配/)

  await writeFile(join(fakeBin, 'pg_dump'), '#!/bin/sh\nexit 7\n')
  const failedBackup = spawnSync(process.execPath, ['scripts/backup.mjs', `backups/${failedBackupName}`], {
    cwd: root, env: baseEnv, encoding: 'utf8',
  })
  assert.notEqual(failedBackup.status, 0)
  await assert.rejects(access(failedBackupDir), { code: 'ENOENT' })
})
