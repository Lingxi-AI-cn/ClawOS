import express from 'express'
import { exec } from 'child_process'
import { promisify } from 'util'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import fetch from 'node-fetch'
import tencentcloud from 'tencentcloud-sdk-nodejs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const execAsync = promisify(exec)
const app = express()
const PORT = process.env.PORT || 3000
const CACHE_DIR = path.join(__dirname, 'cache')
const SKILLS_CACHE = path.join(CACHE_DIR, 'skills.json')
const CLAWHUB = path.join(__dirname, 'node_modules/.bin/clawhub')
const CONVEX_URL = 'https://wry-manatee-359.convex.cloud'
const CONVEX_QUERY_ENDPOINT = `${CONVEX_URL}/api/query`
const PAGE_SIZE = 25

// 腾讯云翻译客户端
const TmtClient = tencentcloud.tmt.v20180321.Client
const tmtClient = new TmtClient({
  credential: {
    secretId: process.env.TENCENT_SECRET_ID,
    secretKey: process.env.TENCENT_SECRET_KEY,
  },
  region: 'ap-beijing',
  profile: {
    httpProfile: {
      endpoint: 'tmt.tencentcloudapi.com',
    },
  },
})

app.use(express.json())
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET, POST')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  next()
})

await fs.mkdir(CACHE_DIR, { recursive: true })

const INCOMPATIBLE = {
  tools: ['docker', 'kubectl', 'git clone', 'brew install', 'apt-get', 'yum', 'cargo'],
  paths: ['/home/', '~/', '/Users/', 'C:\\'],
  permissions: ['sudo ', 'su -', 'root@']
}

function analyzeCompatibility(content) {
  let score = 100
  const issues = []

  for (const tool of INCOMPATIBLE.tools) {
    if (content.toLowerCase().includes(tool.toLowerCase())) {
      score -= 15
      issues.push(`需要工具: ${tool}`)
    }
  }

  for (const p of INCOMPATIBLE.paths) {
    if (content.includes(p)) {
      score -= 10
      issues.push(`使用桌面路径: ${p}`)
    }
  }

  for (const perm of INCOMPATIBLE.permissions) {
    if (content.includes(perm)) {
      score -= 20
      issues.push(`需要特权: ${perm}`)
    }
  }

  return {
    score: Math.max(0, score),
    issues,
    compatible: score >= 60,
    level: score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low'
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))
let lastTranslateTime = 0

async function translateText(text) {
  const now = Date.now()
  const elapsed = now - lastTranslateTime
  if (elapsed < 350) {
    await sleep(350 - elapsed)
  }
  lastTranslateTime = Date.now()

  try {
    const params = {
      SourceText: text,
      Source: 'en',
      Target: 'zh',
      ProjectId: 0
    }
    const response = await tmtClient.TextTranslate(params)
    return { text: response.TargetText, translated: true }
  } catch (error) {
    console.warn('Translation failed:', error.message)
    return { text, translated: false }
  }
}

async function convexQuery(path, args) {
  const resp = await fetch(CONVEX_QUERY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, args }),
  })
  if (!resp.ok) {
    throw new Error(`Convex query failed: ${resp.status} ${resp.statusText}`)
  }
  const data = await resp.json()
  if (data.status !== 'success') {
    throw new Error(`Convex query error: ${JSON.stringify(data)}`)
  }
  return data.value
}

async function fetchTopSkills(total = 100, sort = 'downloads') {
  const allItems = []
  let cursor = undefined

  while (allItems.length < total) {
    const numItems = Math.min(PAGE_SIZE, total - allItems.length)
    console.log(`Fetching page (cursor=${cursor ? '...' : 'null'}, numItems=${numItems})...`)

    const result = await convexQuery('skills:listPublicPageV4', {
      cursor,
      numItems,
      sort,
      dir: 'desc',
    })

    allItems.push(...result.page)
    console.log(`Got ${result.page.length} items, total: ${allItems.length}`)

    if (!result.hasMore || !result.nextCursor) break
    cursor = result.nextCursor
  }

  return allItems
}

let translationInProgress = false

async function translateSkills(skills) {
  if (translationInProgress) return
  translationInProgress = true

  const untranslated = skills.filter(s => !s.translated && s.description)
  if (untranslated.length === 0) {
    translationInProgress = false
    return
  }

  console.log(`Translating ${untranslated.length} skill descriptions...`)
  let translated = 0

  for (const skill of untranslated) {
    try {
      const result = await translateText(skill.description)
      if (result.translated) {
        skill.descriptionZh = result.text
        skill.translated = true
        translated++
        if (translated % 10 === 0) {
          console.log(`Translated ${translated}/${untranslated.length}...`)
        }
      }
    } catch (err) {
      console.warn(`Translation failed for ${skill.slug}:`, err.message)
    }
  }

  console.log(`Translation complete: ${translated}/${untranslated.length} translated`)

  await fs.writeFile(SKILLS_CACHE, JSON.stringify({ timestamp: Date.now(), skills }))
  console.log('Cache updated with translations')
  translationInProgress = false
}

// GET /api/skills - 获取推荐的 skills（按下载量排序）
app.get('/api/skills', async (req, res) => {
  try {
    const cached = await fs.readFile(SKILLS_CACHE, 'utf8').catch(() => null)
    if (cached) {
      const data = JSON.parse(cached)
      if (Date.now() - data.timestamp < 3600000) {
        const hasUntranslated = data.skills.some(s => !s.translated && s.description)
        if (hasUntranslated) {
          translateSkills(data.skills).catch(err =>
            console.error('Background translation error:', err)
          )
        }
        return res.json(data.skills)
      }
    }

    console.log('Fetching top skills via Convex direct query...')
    const items = await fetchTopSkills(100)

    const skills = items.map(item => ({
      slug: item.skill.slug,
      name: item.skill.displayName || item.skill.slug,
      description: item.skill.summary || '',
      descriptionZh: item.skill.summary || '',
      translated: false,
      downloads: item.skill.stats?.downloads || 0,
      stars: item.skill.stats?.stars || 0,
      installs: item.skill.stats?.installsCurrent || 0,
      owner: item.ownerHandle || '',
      compatibility: {
        score: null,
        compatible: null,
        issues: [],
        level: 'unknown'
      }
    }))

    console.log(`Fetched ${skills.length} skills, top: ${skills[0]?.name} (${skills[0]?.downloads} downloads)`)

    await fs.writeFile(SKILLS_CACHE, JSON.stringify({ timestamp: Date.now(), skills }))
    console.log('Cache written successfully')

    res.json(skills)

    translateSkills(skills).catch(err =>
      console.error('Background translation error:', err)
    )
  } catch (error) {
    console.error('Failed to fetch skills:', error)
    res.status(500).json({ error: error.message })
  }
})

// GET /api/skills/:slug/compatibility - 检测兼容性（按需评估）
app.get('/api/skills/:slug/compatibility', async (req, res) => {
  try {
    const { stdout } = await execAsync(`${CLAWHUB} inspect ${req.params.slug}`, { cwd: __dirname })
    const compat = analyzeCompatibility(stdout)
    res.json({ slug: req.params.slug, compatibility: compat })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// GET /api/skills/:slug - 获取详情
app.get('/api/skills/:slug', async (req, res) => {
  try {
    const { stdout } = await execAsync(`${CLAWHUB} show ${req.params.slug}`)
    res.json({ slug: req.params.slug, content: stdout })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// POST /api/skills/:slug/download - 下载 skill 文件
app.post('/api/skills/:slug/download', async (req, res) => {
  const slug = req.params.slug
  const tmpDir = `/tmp/skill-${Date.now()}-${slug}`
  try {
    await execAsync(`mkdir -p ${tmpDir}/.clawhub`)
    await fs.writeFile(path.join(tmpDir, '.clawhub', 'lock.json'), '{"skills":{}}')
    const { stdout, stderr } = await execAsync(`cd ${tmpDir} && ${CLAWHUB} install ${slug} --force`)
    if (stderr) console.warn(`[download] ${slug}: ${stderr.trim()}`)

    const skillDir = path.join(tmpDir, 'skills', slug)
    let baseDir = tmpDir
    try {
      await fs.access(skillDir)
      baseDir = skillDir
    } catch {}

    const readDir = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const files = {}
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          Object.assign(files, await readDir(fullPath))
        } else if (entry.isFile()) {
          const relativePath = path.relative(baseDir, fullPath)
          files[relativePath] = await fs.readFile(fullPath, 'utf8')
        }
      }
      return files
    }

    const files = await readDir(baseDir)
    await execAsync(`rm -rf ${tmpDir}`)

    if (Object.keys(files).length === 0) {
      return res.status(404).json({ error: `No skill files found for ${slug}` })
    }
    res.json({ slug, files })
  } catch (error) {
    console.error(`[download] ${slug} failed:`, error.message?.substring(0, 200))
    await execAsync(`rm -rf ${tmpDir}`).catch(() => {})
    res.status(500).json({ error: error.message })
  }
})

app.listen(PORT, () => console.log(`Skill Service running on port ${PORT}`))
