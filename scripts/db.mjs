import { readFile } from 'node:fs/promises'
import { Client } from 'pg'

const files = process.argv.slice(2)
if (!files.length || !process.env.DATABASE_URL) throw new Error('需要 SQL 文件和 DATABASE_URL')

const client = new Client({ connectionString: process.env.DATABASE_URL })
try {
  await client.connect()
  for (const file of files) {
    await client.query(await readFile(file, 'utf8'))
    console.log(`database: applied ${file}`)
  }
} finally {
  await client.end()
}
