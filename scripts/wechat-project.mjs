import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const appid = process.env.WECHAT_APPID ?? ''
if (!/^wx[0-9a-f]{16}$/i.test(appid)) throw new Error('WECHAT_APPID 必须是 wx 开头的 18 位小程序 AppID')

const file = resolve(process.env.WECHAT_PROJECT_CONFIG ?? 'apps/miniapp/dist/build/mp-weixin/project.config.json')
const config = JSON.parse(await readFile(file, 'utf8'))
config.appid = appid
await writeFile(file, `${JSON.stringify(config, null, 2)}\n`)
console.log(`wechat project: configured ${appid}`)
