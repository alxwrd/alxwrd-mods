import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const KEY = 'speak:enabled'
const SPEED_KEY = 'speak:speed'
const WAV = '/tmp/speak-aloud.wav'
const isOn = atom({ plugin: 'speak-aloud', key: 'isOn' } as const, true)
const speedAtom = atom({ plugin: 'speak-aloud', key: 'speed' } as const, 1)

// fixed so speeds compare like for like: a Harvard sentence
const TEST_LINE = 'The juice of lemons makes fine punch.'

const INSTRUCTIONS = [
  'Read-aloud is on. Begin every reply with a first paragraph that is ONE short, naturally spoken sentence summarising the result or answer, as you would say it to a colleague.',
  'That paragraph must be plain prose: no markdown, code, file paths, URLs, lists or emoji.',
  'Never put code or a full path in it; name a file by its short name instead, such as "the plugin.json file" and not "mods/speak-aloud/.claude-plugin/plugin.json".',
  'Follow it with a blank line, then the rest of the reply as usual.',
].join(' ')

// what `say` needs from `$`, as plain functions (a `$` noun is called where it is spelled)
type Io = {
  run: (argv: string[], timeoutMs: number, stdin?: string) => Promise<{ exitCode: number; stderr: string }>
  readWav: () => Promise<string>
  play: (base64: string) => Promise<void>
  serve: (dataDir: string) => void
}

// everything `speak` needs from `$`, built where `$` is in hand; a module-level
// function, because `$` may only be passed to one
const envOf = (
  $: EngineInterface,
  serve: (spawn: (request: { argv: string[] }) => AsyncIterable<unknown>, dataDir: string) => void,
) => ({
  dataDir: (configured: string) => configured || `${$.plugin.root}/voices`,
  exists: (path: string) => $.fs.exists(path),
  speed: async () => Number((await $.store.get(SPEED_KEY)) ?? 1),
  toast: (text: string) => $.ui.toast(text),
  io: {
    run: (argv, timeoutMs, stdin) => $.process.run(argv, { timeoutMs, stdin }),
    readWav: async () => (await $.fs.read(WAV, { as: 'bytes' })).base64,
    play: base64 => $.audio.play({ base64, mime: 'audio/wav' }),
    serve: dir => serve(request => $.process.spawn(request), dir),
  } satisfies Io,
})

export const register: Register = (on, options) => {
  const voice = String(options.voice ?? 'en_GB-alba-medium')
  const configuredDir = String(options.dataDir ?? '')
  const port = Number(options.port ?? 5123)
  let isSpeaking = false
  let isServerStarted = false

  const serverArgv = (dataDir: string) => [
    'uvx', '--from', 'piper-tts[http]', 'python', '-m', 'piper.http_server',
    '--host', '127.0.0.1', '--port', String(port), '--data-dir', dataDir, '-m', voice,
  ]

  let generation = 0
  // keeps the server alive for as long as this loop runs; `generation` lets a
  // restart supersede a loop whose child was just killed
  const serve = async (
    spawn: (request: { argv: string[] }) => AsyncIterable<unknown>,
    dataDir: string,
  ) => {
    const mine = ++generation
    isServerStarted = true
    try {
      for await (const _chunk of spawn({ argv: serverArgv(dataDir) })) {
        // the server lives as long as this loop
      }
    } catch {
      // fall back to the one-shot CLI
    }
    if (mine === generation) isServerStarted = false
  }

  // synthesizes `text` at `speed` and plays it; resolves an error message, or
  // undefined once it has played
  const say = async (text: string, speed: number, dataDir: string, io: Io) => {
    const lengthScale = String(Math.round((1 / speed) * 1000) / 1000)
    let run = await io.run(
      [
        'curl', '-sS', '-f', '--max-time', '60', '-X', 'POST',
        '-H', 'Content-Type: application/json',
        '-d', JSON.stringify({ text, length_scale: Number(lengthScale) }),
        '-o', WAV, `http://127.0.0.1:${port}/synthesize`,
      ],
      65_000,
    )
    if (run.exitCode !== 0) {
      if (!isServerStarted) io.serve(dataDir)
      // server not ready yet: one-shot CLI
      run = await io.run(
        ['uvx', '--from', 'piper-tts', 'piper', '--data-dir', dataDir, '-m', voice, '--length-scale', lengthScale, '-f', WAV],
        120_000,
        text,
      )
    }
    if (run.exitCode !== 0) return `piper failed (${run.exitCode}): ${run.stderr.slice(-200)}`
    await io.play(await io.readWav())
    return undefined
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'speak',
      description: 'Toggle reading replies aloud (/speak on|off), download a voice (/speak install [voice]), set speed (/speak speed <0.5-2>) or reload the server (/speak reload)',
    })
    await update($, isOn, () => true)
    if ((await $.store.get(KEY)) === false) await update($, isOn, () => false)
    const storedSpeed = Number((await $.store.get(SPEED_KEY)) ?? 1)
    await update($, speedAtom, () => storedSpeed)
    const dataDir = configuredDir || `${$.plugin.root}/voices`
    // another session may already be serving on this port: reuse it
    const live = await $.http.fetch(`http://127.0.0.1:${port}/info`).catch(() => undefined)
    const startServer = () => {
      if (!live?.ok && !isServerStarted) void serve(request => $.process.spawn(request), dataDir)
    }
    if (await $.fs.exists(`${dataDir}/${voice}.onnx`)) {
      startServer()
    } else {
      // first run: fetch the chosen voice in the background, then start the server
      $.ui.toast(`speak: downloading voice ${voice}...`)
      void (async () => {
        const run = await $.process
          .run(
            ['uvx', '--from', 'piper-tts', 'python', '-m', 'piper.download_voices', voice, '--data-dir', dataDir],
            { timeoutMs: 600_000 },
          )
          .catch(() => undefined)
        if (run?.exitCode === 0) {
          $.ui.toast(`speak: voice ${voice} ready`)
          startServer()
        } else {
          $.ui.toast(`speak: voice download failed; run /speak install`)
        }
      })()
    }
    return next(e)
  })

  on('command.run', { command: 'speak' }, async ($, e) => {
    const [word = '', name] = e.args.trim().split(/\s+/)
    const arg = word.toLowerCase()
    if (arg === 'install') {
      const target = name || voice
      const dataDir = configuredDir || `${$.plugin.root}/voices`
      const run = await $.process.run(
        ['uvx', '--from', 'piper-tts', 'python', '-m', 'piper.download_voices', target, '--data-dir', dataDir],
        { timeoutMs: 600_000 },
      )
      if (run.exitCode !== 0) {
        return { text: `Voice install failed (${run.exitCode}): ${run.stderr.slice(-400)}` }
      }
      const hint = target === voice ? '' : ` Set the "voice" option to ${target} to use it.`
      return { text: `Installed voice ${target} into ${dataDir}.${hint}` }
    }
    if (arg === 'reload') {
      const dataDir = configuredDir || `${$.plugin.root}/voices`
      if (!(await $.fs.exists(`${dataDir}/${voice}.onnx`))) {
        return { text: `Voice ${voice} is not installed; run /speak install first.` }
      }
      await $.process
        .run(['pkill', '-f', `piper.http_server.*--port ${port}( |$)`], { timeoutMs: 5_000 })
        .catch(() => undefined)
      void serve(request => $.process.spawn(request), dataDir)
      return { text: `Reloaded the Piper server on port ${port}.` }
    }
    if (arg === 'speed') {
      if (name === undefined) {
        const now = Number((await $.store.get(SPEED_KEY)) ?? 1)
        return { text: `Playback speed is ${now}x. Usage: /speak speed <0.5-2>` }
      }
      const speed = Number(name)
      if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) {
        return { text: 'Speed must be a number from 0.5 to 2 (1 is normal).' }
      }
      await $.store.set(SPEED_KEY, speed)
      await update($, speedAtom, () => speed)
      const dataDir = configuredDir || `${$.plugin.root}/voices`
      if (!(await $.fs.exists(`${dataDir}/${voice}.onnx`))) {
        return { text: `Playback speed set to ${speed}x. Voice ${voice} is not installed; run /speak install.` }
      }
      let failure: string | undefined
      try {
        failure = await say(TEST_LINE, speed, dataDir, {
          run: (argv, timeoutMs, stdin) => $.process.run(argv, { timeoutMs, stdin }),
          readWav: async () => (await $.fs.read(WAV, { as: 'bytes' })).base64,
          play: base64 => $.audio.play({ base64, mime: 'audio/wav' }),
          serve: dir => void serve(request => $.process.spawn(request), dir),
        })
      } catch (err) {
        failure = err instanceof Error ? err.message : String(err)
      }
      const note = failure ? ` (test message failed: ${failure})` : ''
      return { text: `Playback speed set to ${speed}x.${note}` }
    }
    if (arg === 'on' || arg === 'off') {
      await $.store.set(KEY, arg === 'on')
      await update($, isOn, () => arg === 'on')
      return { text: `Speaking is ${arg}.` }
    }
    const state = (await $.store.get(KEY)) !== false ? 'on' : 'off'
    return { text: `Speaking is ${state}. Usage: /speak on|off, /speak install [voice], /speak speed <0.5-2>, /speak reload` }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if ((await $.store.get(KEY)) === false) return composed
    return {
      sections: [
        ...composed.sections,
        { id: 'speak-aloud:spoken-first-paragraph', text: INSTRUCTIONS, scope: 'session' },
      ],
    }
  })

  // speaks `text` and toasts a failure; resolves once it has played or failed
  const speak = async (env: ReturnType<typeof envOf>, text: string) => {
    if (isSpeaking) return
    isSpeaking = true
    try {
      const dataDir = env.dataDir(configuredDir)
      if (!(await env.exists(`${dataDir}/${voice}.onnx`))) {
        env.toast(`speak: voice ${voice} not installed; run /speak install`)
        return
      }
      const failure = await say(text, await env.speed(), dataDir, env.io)
      if (failure) env.toast(`speak: ${failure}`)
    } catch (err) {
      env.toast(`speak: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      isSpeaking = false
    }
  }

  const startServe = (spawn: (request: { argv: string[] }) => AsyncIterable<unknown>, dataDir: string) =>
    void serve(spawn, dataDir)

  // the turn whose first paragraph `turn.step` already started speaking
  let spokenTurn: string | undefined

  // starts speaking as soon as the first paragraph has streamed in, while the
  // rest of the reply is still arriving; every chunk passes on unchanged
  on('turn.step', async function* ($, e, next) {
    const stream = next(e)
    if (e.agentId !== undefined || e.turnId === spokenTurn || (await $.store.get(KEY)) === false) {
      return yield* stream
    }
    let text = ''
    let blockIndex: number | undefined
    let speech: Promise<void> | undefined
    for await (const chunk of stream) {
      yield chunk
      if (speech || chunk.kind !== 'text') continue
      blockIndex ??= chunk.index
      if (chunk.index !== blockIndex) continue
      text += chunk.text
      const end = text.trimStart().indexOf('\n\n')
      if (end === -1) continue
      spokenTurn = e.turnId
      speech = speak(envOf($, startServe), text.trimStart().slice(0, end).trim())
    }
    // `$` is only good while this hook runs, so the speech is awaited here
    await speech
    return await stream.result
  })

  // the fallback: a reply with no blank line never spoke from `turn.step`
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || e.reason !== 'answer') return result
    if (e.turnId === spokenTurn || (await $.store.get(KEY)) === false) return result

    const text = e.answer.trim().split('\n\n')[0]?.trim()
    if (text) await speak(envOf($, startServe), text)
    return result
  })

  // the footer's mode labels: a coloured dot for speaking on (green) or off (red)
  on('ui.render', { component: 'SessionMode' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const isActive = await read($, isOn)
    const speed = await read($, speedAtom)
    const label = speed === 1 ? '• speak' : `• speak (${speed}x)`
    const modes = e.props.modes

    return (
      <Box>
        {modes.length > 0 && <Text dimColor>{modes.join(' & ')} </Text>}
        <Text color={isActive ? 'green' : 'red'}>{label}</Text>
      </Box>
    )
  })
}
