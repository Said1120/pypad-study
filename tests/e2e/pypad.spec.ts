import { expect, test } from '@playwright/test'

async function waitForRuntime(page: import('@playwright/test').Page) {
  await expect(page.locator('.runtime-pill')).toContainText('Python 已就绪', { timeout: 60_000 })
}

async function replaceCode(page: import('@playwright/test').Page, code: string) {
  const editor = page.getByRole('textbox', { name: 'Python 代码编辑器' })
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.insertText(code)
}

test('loads in an isolated context and runs Python locally', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'PyPad 学习台' })).toBeVisible()
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true)
  await waitForRuntime(page)

  await replaceCode(page, 'print("来自 iPad 的 Python")\n')
  await page.getByRole('button', { name: '▶ 运行', exact: true }).click()

  await expect(page.locator('.console')).toContainText('来自 iPad 的 Python', { timeout: 30_000 })
})

test('accepts live input without sending the source to a server', async ({ page }) => {
  const requests: string[] = []
  page.on('request', (request) => requests.push(request.url()))
  await page.goto('/')
  await waitForRuntime(page)
  await replaceCode(page, 'name = input("你的名字：")\nprint("你好", name)\n')

  await page.getByRole('button', { name: '▶ 运行', exact: true }).click()
  await page.getByRole('textbox', { name: '程序输入' }).fill('小明')
  await page.getByRole('button', { name: '提交输入' }).click()

  await expect(page.locator('.console')).toContainText('你好 小明', { timeout: 30_000 })
  expect(requests.every((url) => !url.includes('name%20%3D%20input') && !url.includes('print%28'))).toBe(true)
})

test('stops an infinite loop and returns the editor to ready state', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  await replaceCode(page, 'while True:\n    pass\n')
  await page.getByRole('button', { name: '▶ 运行', exact: true }).click()
  await expect(page.getByRole('button', { name: '停止' })).toBeEnabled()
  await page.getByRole('button', { name: '停止' }).click()

  await expect(page.locator('.runtime-pill')).toContainText(/运行已停止|Python 已就绪/, { timeout: 10_000 })
})

test('runs a project that imports another local file', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  page.once('dialog', (dialog) => dialog.accept('helper.py'))
  await page.getByRole('button', { name: '新建文件', exact: true }).click()
  await replaceCode(page, 'answer = 42\n')
  await page.getByRole('button', { name: 'main.py 运行', exact: true }).click()
  await replaceCode(page, 'from helper import answer\nprint(answer)\n')

  await page.getByRole('button', { name: '▶ 运行', exact: true }).click()

  await expect(page.locator('.console')).toContainText('42', { timeout: 30_000 })
})

test('renders a Matplotlib figure in the output panel', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  await replaceCode(page, 'import matplotlib.pyplot as plt\nplt.plot([1, 3, 2])\n')

  await page.getByRole('button', { name: '▶ 运行', exact: true }).click()

  await expect(page.getByRole('img', { name: 'Python 生成的图表' })).toBeVisible({ timeout: 60_000 })
})

test('reopens the app and Python runtime while offline', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright WebKit on Windows cannot navigate after setOffline; verify on a physical iPad.')
  await page.goto('/')
  await waitForRuntime(page)
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready
    if (!registration.active) throw new Error('Service worker is not active')
  })
  await context.setOffline(true)

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'PyPad 学习台' })).toBeVisible()
  await waitForRuntime(page)
})

test('exports a ZIP and imports it as a runnable project', async ({ page }) => {
  await page.goto('/')
  await waitForRuntime(page)
  await replaceCode(page, 'print("ZIP 往返成功")\n')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 ZIP' }).click()
  const download = await downloadPromise
  const archivePath = await download.path()
  if (!archivePath) throw new Error('Browser did not retain the exported ZIP')

  page.once('dialog', (dialog) => dialog.accept())
  await page.locator('input[type="file"]').setInputFiles(archivePath)
  await page.getByRole('button', { name: '▶ 运行', exact: true }).click()

  await expect(page.locator('.console')).toContainText('ZIP 往返成功', { timeout: 30_000 })
})

test('runs a prepared scientific package after an offline restart', async ({ page, context, browserName }) => {
  test.setTimeout(120_000)
  test.skip(browserName === 'webkit', 'Playwright WebKit on Windows cannot navigate after setOffline; verify on a physical iPad.')
  await page.goto('/')
  await waitForRuntime(page)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
    }
  })
  await replaceCode(page, 'import numpy as np\nprint(np.arange(3))\n')
  await page.getByRole('button', { name: '▶ 运行', exact: true }).click()
  await expect(page.locator('.console')).toContainText('[0 1 2]', { timeout: 60_000 })
  await page.evaluate(() => navigator.serviceWorker.ready)
  await context.setOffline(true)

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await waitForRuntime(page)
  await replaceCode(page, 'import numpy as np\nprint(np.arange(3))\n')
  await page.getByRole('button', { name: '▶ 运行', exact: true }).click()

  await expect(page.locator('.console')).toContainText('[0 1 2]', { timeout: 60_000 })
})
