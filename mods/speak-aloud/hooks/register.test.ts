import { test, expect, mock } from 'claude-code/testing'

const answer = (text: string) => ({
  answer: text,
  durationMs: 1,
  isAborted: false,
  turnId: 't1',
  reason: 'answer',
}) as never

test('speaks only the first paragraph', async ($, on) => {
  const spoken: string[] = []
  let isPlayed = false
  on('process.run', async (_$, e) => {
    spoken.push((e as { argv: string[] }).argv.join(' '))
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('fs.exists', async () => ({ value: true }) as never)
  on('fs.read', async () => ({ value: { base64: 'AAAA' } }) as never)
  on('audio.play', async () => {
    isPlayed = true
    return { value: undefined } as never
  })
  on('turn.complete', async () => ({ text: '' }))
  mock.store(on)
  await $.turn.complete(answer('All done here.\n\nMore detail\nbelow.'))
  expect(isPlayed).toBe(true)
  expect(spoken[0]).toContain('All done here.')
  expect(spoken[0]).not.toContain('More detail')
})

test('/speak off silences it', async ($, on) => {
  let isPlayed = false
  mock.store(on)
  on('command.run', async () => ({}))
  on('turn.complete', async () => ({ text: '' }))
  on('audio.play', async () => {
    isPlayed = true
    return { value: undefined } as never
  })
  const out = await $.command.run({ command: 'speak', args: 'off' })
  expect(out.text).toContain('off')
  await $.turn.complete(answer('Hello.'))
  expect(isPlayed).toBe(false)
})

test('/speak install downloads the voice into the data dir', async ($, on) => {
  const argvs: string[][] = []
  mock.store(on)
  on('process.run', async (_$, e) => {
    argvs.push((e as { argv: string[] }).argv)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('command.run', async () => ({}))
  const out = await $.command.run({ command: 'speak', args: 'install en_GB-alan-medium' })
  expect(argvs[0]).toContain('piper.download_voices')
  expect(argvs[0]).toContain('en_GB-alan-medium')
  expect(out.text).toContain('Installed voice en_GB-alan-medium')
})

test('session start reuses a live server and never kills one', async ($, on) => {
  const argvs: string[][] = []
  on('process.run', async (_$, e) => {
    argvs.push((e as { argv: string[] }).argv)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('http.fetch', async () => ({ value: { status: 200, ok: true, headers: {}, text: '{}' } }) as never)
  let isSpawned = false
  on('process.spawn', async function* () {
    isSpawned = true
  })
  on('fs.exists', async () => ({ value: true }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.start', async () => ({ cwd: '/tmp' }) as never)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  expect(isSpawned).toBe(false)
  expect(argvs.some(argv => argv[0] === 'pkill')).toBe(false)
})

test('/speak reload kills then respawns the server', async ($, on) => {
  const argvs: string[][] = []
  let isSpawned = false
  mock.store(on)
  on('process.run', async (_$, e) => {
    argvs.push((e as { argv: string[] }).argv)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('process.spawn', async function* () {
    isSpawned = true
    return { value: { code: 0, signal: null } } as never
  })
  on('fs.exists', async () => ({ value: true }) as never)
  on('command.run', async () => ({}))
  const out = await $.command.run({ command: 'speak', args: 'reload' })
  expect(argvs[0]?.[0]).toBe('pkill')
  expect(argvs[0]?.join(' ')).toContain('--port 5123')
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(isSpawned).toBe(true)
  expect(out.text).toContain('Reloaded')
})

test('/speak speed sets, bounds and plays a test message', async ($, on) => {
  let isPlayed = false
  const argvs: string[][] = []
  mock.store(on)
  on('process.run', async (_$, e) => {
    argvs.push((e as { argv: string[] }).argv)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('fs.exists', async () => ({ value: true }) as never)
  on('fs.read', async () => ({ value: { base64: 'AAAA' } }) as never)
  on('audio.play', async () => {
    isPlayed = true
    return { value: undefined } as never
  })
  on('command.run', async () => ({}))
  expect((await $.command.run({ command: 'speak', args: 'speed 1.5' })).text).toContain('1.5x')
  expect(isPlayed).toBe(true)
  expect(argvs[0]?.join(' ')).toContain('juice of lemons')
  isPlayed = false
  expect((await $.command.run({ command: 'speak', args: 'speed 9' })).text).toContain('0.5 to 2')
  expect(isPlayed).toBe(false)
  expect((await $.command.run({ command: 'speak', args: 'speed' })).text).toContain('1.5x')
})

test('speech uses length_scale from the speed', async ($, on) => {
  const argvs: string[][] = []
  mock.store(on)
  on('process.run', async (_$, e) => {
    argvs.push((e as { argv: string[] }).argv)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  on('fs.exists', async () => ({ value: true }) as never)
  on('fs.read', async () => ({ value: { base64: 'AAAA' } }) as never)
  on('audio.play', async () => ({ value: undefined }) as never)
  on('command.run', async () => ({}))
  on('turn.complete', async () => ({ text: '' }))
  await $.command.run({ command: 'speak', args: 'speed 2' })
  await $.turn.complete(answer('Hi.'))
  expect(argvs[0]?.join(' ')).toContain('"length_scale":0.5')
})

test('session start downloads the voice when it is missing', async ($, on) => {
  const argvs: string[][] = []
  mock.store(on)
  on('process.run', async (_$, e) => {
    argvs.push((e as { argv: string[] }).argv)
    return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
  })
  on('http.fetch', async () => ({ value: { status: 500, ok: false, headers: {}, text: '' } }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('fs.exists', async () => ({ value: false }) as never)
  on('command.register', async () => ({ value: undefined }) as never)
  on('session.start', async () => ({ cwd: '/tmp' }) as never)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as never)
  await new Promise(resolve => setTimeout(resolve, 0))
  const download = argvs.find(argv => argv.includes('piper.download_voices'))
  expect(download).toContain('en_GB-alba-medium')
})
