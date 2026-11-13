// pinwright overlay. "N" (or ⌥N, or the button) toggles note mode; a click drops a pin on an
// element and asks for the note. Agents pick notes up on the daemon; pins show their progress.
// Everything lives in a shadow root, so the page's CSS and ours never meet.
;(() => {
  if (navigator.webdriver || window.__pinwrightLoaded) return
  window.__pinwrightLoaded = true

  const script = document.currentScript
  const BASE = script && script.src ? new URL(script.src).origin : location.origin
  const API = `${BASE}/__pw`
  const CFG = window.__pinwright || {}
  const LANG = String(CFG.lang || navigator.language || 'en').slice(0, 2) === 'it' ? 'it' : 'en'
  const tokensOf = (t) => (!t ? '0' : t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${Math.round(t / 1e3)}k` : String(t))
  const T = {
    it: {
      notes: (n) => `✎ Note (${n})`,
      waiting: (n) => ` · ${n} da rispondere`,
      mode: 'Clicca dove vuoi la nota (Esc o ⌥N per uscire)',
      write: 'Scrivi la nota… (Invio salva, Shift+Invio va a capo)',
      cancel: 'Annulla',
      save: 'Salva',
      close: 'Chiudi',
      del: 'Elimina',
      sure: 'Sicuro? Elimina',
      reply: 'Rispondi',
      answer: 'Rispondi… (Invio invia, Shift+Invio va a capo)',
      follow: 'Non proprio… (Invio la rimanda all’agente)',
      send: 'Invia',
      archive: 'Archivia',
      undo: 'Annulla modifica',
      retry: 'Riprova',
      handoff: 'Passa a mano',
      changes: (n) => `Modifiche (${n} file)`,
      before: 'Prima',
      after: 'Dopo',
      you: 'Tu',
      agent: 'Claude',
      system: 'pinwright',
      take: (id) => `Da prendere in Claude Code: pinwright take ${id}`,
      empty: 'Nessuna nota su questa pagina. Premi N (o ⌥N) o il bottone, poi clicca un punto.',
      other: 'Su altre pagine',
      showDone: (n) => `Mostra fatte (${n})`,
      hideDone: 'Nascondi fatte',
      offline: 'pinwright non raggiungibile',
      click: 'clicca per aprire',
      cost: (n) => `${n.tokens ? `${tokensOf(n.tokens)} token · ` : ""}$${n.costUsd.toFixed(n.costUsd < 0.01 ? 3 : 2)}`,
      st: { queued: 'In coda', planning: 'Pianifica', working: 'Ci lavora', done: 'Fatto', asking: 'Domanda', handoff: 'A mano', failed: 'Fallita' },
    },
    en: {
      notes: (n) => `✎ Notes (${n})`,
      waiting: (n) => ` · ${n} to answer`,
      mode: 'Click where the note goes (Esc or ⌥N to leave)',
      write: 'Write the note… (Enter saves, Shift+Enter new line)',
      cancel: 'Cancel',
      save: 'Save',
      close: 'Close',
      del: 'Delete',
      sure: 'Sure? Delete',
      reply: 'Reply',
      answer: 'Answer… (Enter sends, Shift+Enter new line)',
      follow: 'Not quite… (Enter sends it back to the agent)',
      send: 'Send',
      archive: 'Archive',
      undo: 'Undo change',
      retry: 'Retry',
      handoff: 'Hand off',
      changes: (n) => `Changes (${n} file${n === 1 ? '' : 's'})`,
      before: 'Before',
      after: 'After',
      you: 'You',
      agent: 'Claude',
      system: 'pinwright',
      take: (id) => `Take it in Claude Code: pinwright take ${id}`,
      empty: 'No notes on this page. Press N (or ⌥N) or the button, then click a spot.',
      other: 'On other pages',
      showDone: (n) => `Show done (${n})`,
      hideDone: 'Hide done',
      offline: 'pinwright not reachable',
      click: 'click to open',
      cost: (n) => `${n.tokens ? `${tokensOf(n.tokens)} tokens · ` : ""}$${n.costUsd.toFixed(n.costUsd < 0.01 ? 3 : 2)}`,
      st: { queued: 'Queued', planning: 'Planning', working: 'Working', done: 'Done', asking: 'Question', handoff: 'Hand off', failed: 'Failed' },
    },
  }[LANG]

  const css = `
  *{box-sizing:border-box}
  .ui{pointer-events:auto;font:14px/1.45 system-ui,-apple-system,sans-serif;color:#121318;letter-spacing:normal;text-transform:none;text-align:left}
  button{font:700 13px system-ui,-apple-system,sans-serif;cursor:pointer}
  .btn{position:fixed;right:16px;bottom:16px;display:flex;gap:8px;align-items:center;padding:12px 16px;border:0;border-radius:999px;background:#ff3b6b;color:#fff;font-size:14px;box-shadow:0 10px 30px rgb(0 0 0/.3)}
  .btn[data-on]{background:#121318;outline:3px solid #ff3b6b}
  .btn[data-off]{background:#8a8f9c}
  .list{position:fixed;right:16px;bottom:72px;width:340px;max-height:55vh;overflow:auto;padding:10px;border-radius:16px;background:#fff;box-shadow:0 20px 50px rgb(0 0 0/.3)}
  .list[hidden]{display:none}
  .list ol{margin:0;padding:0}
  .list li{display:flex;gap:8px;align-items:flex-start;padding:8px;border-radius:10px;list-style:none;cursor:pointer}
  .list li:hover{background:#f1f2f5}
  .list li b{flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--c);color:#fff;font-size:12px}
  .list li span{flex:1;white-space:pre-wrap;overflow-wrap:anywhere}
  .list li small{flex:none;color:var(--c);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding-top:3px}
  .list h4{margin:10px 8px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8a8f9c}
  .list p{margin:6px}
  .list em.cost{display:block;margin-top:2px;font-style:normal;color:#8a8f9c;font-size:12px}
  .list .toggle{display:block;margin:8px 6px 2px;padding:0;border:0;background:none;color:#5f6474;font-size:12px;text-decoration:underline}
  .hl{position:fixed;pointer-events:none;outline:2px dashed #ff3b6b;outline-offset:2px;border-radius:2px;display:none}
  .pin{position:fixed;display:grid;place-items:center;width:28px;height:28px;margin:-28px 0 0 0;border-radius:50% 50% 50% 0;background:var(--c);color:#fff;font:800 13px system-ui,sans-serif;box-shadow:0 4px 12px rgb(0 0 0/.35);cursor:pointer;transform:rotate(-45deg);transform-origin:0 100%}
  .pin i{font-style:normal;transform:rotate(45deg)}
  .pin:hover::after{content:attr(data-text);position:absolute;left:34px;top:0;width:max-content;max-width:280px;padding:8px 10px;border-radius:10px;background:#121318;color:#fff;font:500 13px/1.35 system-ui,sans-serif;white-space:pre-wrap;transform:rotate(45deg);transform-origin:0 0}
  .s-queued{--c:#ff3b6b}
  .s-planning,.s-working{--c:#7a5cff}
  .s-asking{--c:#12a9c8}
  .s-done{--c:#16a34a}
  .s-failed{--c:#dc2626}
  .s-handoff{--c:#f97316}
  .pin .dots{display:flex;gap:2px}
  .pin .dots b{width:4px;height:4px;border-radius:50%;background:#fff;animation:dot 1s ease-in-out infinite}
  .pin .dots b:nth-child(2){animation-delay:.15s}
  .pin .dots b:nth-child(3){animation-delay:.3s}
  @keyframes dot{0%,60%,100%{translate:0 0;opacity:.5}30%{translate:0 -3px;opacity:1}}
  @keyframes spin{to{transform:rotate(360deg)}}
  .pin.s-asking{animation:bounce 1.4s ease-in-out infinite}
  @keyframes bounce{50%{translate:3px -3px}}
  .pin.s-asking i::after{content:"?";margin-left:1px}
  .pin.s-done i{font-size:0}
  .pin.s-done i::after{content:"✓";font-size:15px}
  .card{position:fixed;width:320px;padding:12px;border-radius:14px;background:#fff;box-shadow:0 20px 50px rgb(0 0 0/.35)}
  .panel{width:400px;max-height:75vh;overflow:auto;padding:14px}
  textarea{display:block;width:100%;min-height:70px;padding:8px;border:1px solid #d6d8de;border-radius:8px;font:14px/1.4 system-ui,sans-serif;color:#121318;background:#fff;resize:vertical}
  .row{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:8px}
  .row button{padding:8px 14px;border:0;border-radius:999px;background:#eef1f5;color:#121318}
  .row .ok{background:#121318;color:#fff}
  .row .del{margin-right:auto;background:none;color:#c4243f}
  .row .del[data-sure]{background:#c4243f;color:#fff}
  .head{display:flex;align-items:center;gap:8px;margin-bottom:10px}
  .head b{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--c);color:#fff;font-size:12px}
  .head span{color:var(--c);font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .head small{color:#8a8f9c;font-size:12px}
  .head button{margin-left:auto;border:0;background:none;color:#8a8f9c;font-size:18px;line-height:1}
  .msg{margin:0 0 8px;white-space:pre-wrap;overflow-wrap:anywhere}
  .msg em{display:block;font-style:normal;font-weight:700;font-size:12px;color:#5f6474;margin-bottom:2px}
  .msg.agent{padding:8px 10px;border-radius:10px;background:#eef1f5}
  .msg.system{color:#8a8f9c;font-size:13px}
  .act{display:flex;gap:8px;align-items:center;margin:4px 0 8px;color:#7a5cff;font-weight:600;font-size:13px}
  .act::before{content:"";width:12px;height:12px;flex:none;border-radius:50%;border:2px solid #7a5cff;border-top-color:transparent;animation:spin .8s linear infinite}
  .hint{margin:6px 0;padding:8px 10px;border-radius:8px;background:#fff4ec;color:#9a3412;font:12px/1.4 ui-monospace,monospace;user-select:all}
  .err{margin:6px 0;color:#c4243f;font-size:13px}
  details{margin:8px 0}
  summary{cursor:pointer;font-weight:700;font-size:13px}
  pre{margin:6px 0 0;padding:8px;max-height:260px;overflow:auto;border-radius:8px;background:#0f1117;color:#d6d8de;font:11.5px/1.45 ui-monospace,monospace;white-space:pre}
  pre .a{color:#4ade80}
  pre .d{color:#f87171}
  pre .h{color:#93c5fd}
  .shots{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0}
  .shots h5{margin:0;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8a8f9c}
  .shots a{display:block;border-radius:6px;overflow:hidden;border:1px solid #e3e5ea;background:#f5f6f8}
  .shots img{display:block;width:100%;height:150px;object-fit:cover;object-position:top}
  .cost{color:#8a8f9c;font-size:11px;margin-top:6px;text-align:right}
  .toasts{position:fixed;right:16px;bottom:72px;display:flex;flex-direction:column;gap:8px;width:340px}
  .toast{position:relative;padding:10px 32px 10px 14px;border-radius:12px;border-left:5px solid var(--c);background:#fff;box-shadow:0 12px 32px rgb(0 0 0/.25);cursor:pointer;animation:toast-in .2s ease-out}
  .toast b{display:block;color:var(--c);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .toast p{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
  .toast small{display:block;margin-top:4px;color:#8a8f9c;font-size:12px}
  .toast button{position:absolute;top:6px;right:8px;border:0;background:none;color:#8a8f9c;font-size:16px;line-height:1}
  @keyframes toast-in{from{opacity:0;translate:0 8px}}
  .list:not([hidden]) ~ .toasts{display:none}`

  // --- host: one element, in the top layer so it stays above (and usable over) a modal dialog.
  const host = document.createElement('pinwright-root')
  host.setAttribute('popover', 'manual')
  host.style.cssText =
    'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647;color-scheme:light'
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = css
  root.append(style)
  document.body.append(host)
  // A modal dialog makes the rest of the page inert: the host moves inside it while it's open.
  const raise = () => {
    try {
      const modal = [...document.querySelectorAll('dialog[open]')].filter((d) => d.matches(':modal')).at(-1)
      const home = modal ?? document.body
      if (host.parentElement !== home) home.append(host)
      if (host.matches(':popover-open')) host.hidePopover()
      host.showPopover()
    } catch {}
  }
  raise()
  new MutationObserver(() => setTimeout(raise, 0)).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] })

  /** Tiny DOM helper: h('div.card.ui', {onclick}, child, 'text'). */
  function h(tag, props, ...kids) {
    const [name, ...cls] = tag.split('.')
    const el = document.createElement(name || 'div')
    if (cls.length) el.className = cls.join(' ')
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
      else if (k === 'text') el.textContent = v
      else if (k in el && k !== 'list') el[k] = v
      else el.setAttribute(k, v === true ? '' : v)
    }
    for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c)
    return el
  }

  const page = location.pathname
  const VISIBLE = ['queued', 'planning', 'working', 'done', 'asking', 'handoff', 'failed']
  let notes = []
  const activity = {}
  let on = false
  let target = null
  let panelId = null
  // Done notes stay out of the way unless asked for; the choice sticks per browser.
  let showDone = false
  try {
    showDone = localStorage.getItem('pw-show-done') === '1'
  } catch {}
  const shown = (n) => showDone || n.status !== 'done'
  let online = true

  const hl = h('div.hl')
  const btn = h('button.btn.ui')
  const list = h('div.list.ui', { hidden: true })
  const pins = h('div')
  const toasts = h('div.toasts')
  root.append(hl, pins, list, toasts, btn)

  const api = async (path, opts = {}) => {
    const r = await fetch(API + path, { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined })
    const data = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(data.error || r.statusText)
    return data
  }

  const sel = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`
    const parts = []
    while (el && el !== document.body && el !== document.documentElement && parts.length < 8) {
      let s = el.tagName.toLowerCase()
      const cls = [...el.classList].filter((c) => !/^(in|out|live|active|hover|focus|open|is-.*|astro-.*)$/.test(c)).slice(0, 2)
      if (cls.length) s += `.${cls.map(CSS.escape).join('.')}`
      const p = el.parentElement
      if (p) {
        const same = [...p.children].filter((c) => c.tagName === el.tagName)
        if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`
      }
      parts.unshift(s)
      el = p
      if (el && el.id) {
        parts.unshift(`#${CSS.escape(el.id)}`)
        break
      }
    }
    return parts.join(' > ')
  }
  const textOf = (el) => (el.innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 200)
  const STYLE_KEYS = ['display', 'position', 'width', 'height', 'margin', 'padding', 'color', 'background-color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'border', 'border-radius', 'gap', 'flex-direction', 'justify-content', 'align-items', 'grid-template-columns', 'opacity', 'z-index']
  const stylesOf = (el) => {
    const cs = getComputedStyle(el)
    const out = {}
    for (const k of STYLE_KEYS) {
      const v = cs.getPropertyValue(k)
      if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px') out[k] = v
    }
    return out
  }

  const visible = () => notes.filter((n) => VISIBLE.includes(n.status))
  const mine = () => visible().filter((n) => n.page === page)
  const numberOf = (id) => mine().findIndex((n) => n.id === id) + 1
  const findEl = (n) => {
    try {
      return n.selector ? document.querySelector(n.selector) : null
    } catch {
      return null
    }
  }
  const busy = (n) => n.status === 'working' || n.status === 'planning'
  const short = (s, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s)

  /** Pins sit on their element, in viewport coordinates: set again on scroll, resize and layout shifts. */
  function place() {
    for (const pin of pins.children) {
      const n = notes.find((x) => x.id === pin.dataset.id)
      if (!n) continue
      const el = findEl(n)
      let x = (n.pageX ?? 0) - scrollX
      let y = (n.pageY ?? 0) - scrollY
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.width || r.height) {
          x = r.left + r.width * (n.fx ?? 0)
          y = r.top + r.height * (n.fy ?? 0)
        }
      }
      pin.style.left = `${x}px`
      pin.style.top = `${y}px`
    }
    const panel = root.querySelector('.panel')
    if (panel) {
      const pin = [...pins.children].find((p) => p.dataset.id === panel.dataset.id)
      if (pin) position(panel, pin.getBoundingClientRect())
    }
  }
  function position(card, r) {
    const w = card.offsetWidth || 400
    const hgt = card.offsetHeight || 300
    let left = r.right + 10
    if (left + w > innerWidth - 8) left = r.left - w - 10
    left = Math.max(8, Math.min(left, innerWidth - w - 8))
    const top = Math.max(8, Math.min(r.top - 10, innerHeight - hgt - 8))
    card.style.left = `${left}px`
    card.style.top = `${top}px`
  }

  function render() {
    const all = mine()
    const ns = all.filter(shown)
    const open = all.filter((n) => n.status !== 'done').length
    const waiting = all.filter((n) => n.status === 'asking').length
    btn.textContent = !online ? T.offline : on ? T.mode : T.notes(open) + (waiting ? T.waiting(waiting) : '')
    btn.toggleAttribute('data-on', on)
    btn.toggleAttribute('data-off', !online)
    // Pins are rebuilt only when what they show changed, so one never vanishes under the pointer.
    const sig = JSON.stringify(ns.map((n) => [n.id, n.status, n.text, activity[n.id]]))
    if (pins.dataset.sig !== sig) {
      pins.dataset.sig = sig
      pins.replaceChildren(
        ...ns.map((n) => {
          const i = all.indexOf(n)
          const act = activity[n.id]
          const tip = `${T.st[n.status]}${act ? ` · ${act}` : ''}\n\n${short(n.text, 200)}\n\n(${T.click})`
          return h(`div.pin.ui.s-${n.status}`, { 'data-id': n.id, 'data-text': tip, onclick: (e) => (e.stopPropagation(), openPanel(n.id)) }, busy(n) ? h('i.dots', {}, h('b'), h('b'), h('b')) : h('i', { text: String(i + 1) }))
        }),
      )
    }
    place()
    renderList()
  }

  function renderList() {
    if (list.hidden) return
    const all = mine()
    const ns = all.filter(shown)
    const others = visible().filter((n) => n.page !== page && shown(n))
    const done = visible().filter((n) => n.status === 'done').length
    const item = (n, i, here) =>
      h(
        `li.s-${n.status}`,
        { onclick: () => (here ? focusPin(n.id) : (location.href = n.page)) },
        h('b', { text: here ? String(i + 1) : '•' }),
        h(
          'span',
          {},
          here ? short(n.text) : `${n.page}  ${short(n.text, 80)}`,
          n.status === 'done' && n.costUsd ? h('em.cost', { text: T.cost(n) }) : null,
        ),
        h('small', { text: T.st[n.status] }),
      )
    const parts = [
      ns.length ? h('ol', {}, ns.map((n) => item(n, all.indexOf(n), true))) : h('p', { text: T.empty }),
      others.length ? [h('h4', { text: T.other }), h('ol', {}, others.map((n, i) => item(n, i, false)))] : null,
      done || showDone
        ? h('button.toggle', {
            text: showDone ? T.hideDone : T.showDone(done),
            onclick: (e) => {
              e.stopPropagation()
              showDone = !showDone
              try {
                localStorage.setItem('pw-show-done', showDone ? '1' : '0')
              } catch {}
              if (!showDone && panelId && notes.find((n) => n.id === panelId)?.status === 'done') closePanel()
              render()
            },
          })
        : null,
    ]
    // replaceChildren would print a null as the text "null".
    list.replaceChildren(...parts.flat().filter(Boolean))
  }

  function focusPin(id) {
    const n = notes.find((x) => x.id === id)
    const el = n && findEl(n)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    else if (n) scrollTo({ top: (n.pageY ?? 0) - innerHeight / 2, behavior: 'smooth' })
    setTimeout(() => openPanel(id), 350)
  }

  // --- data: one fetch, then server-sent events.
  const upsert = (n) => {
    const i = notes.findIndex((x) => x.id === n.id)
    if (i >= 0) notes[i] = n
    else notes.push(n)
  }
  const loadAll = () =>
    api('/notes')
      .then((d) => {
        notes = d
        online = true
        render()
      })
      .catch(() => {
        online = false
        render()
      })

  const es = new EventSource(`${API}/events`)
  es.addEventListener('hello', (e) => {
    const d = JSON.parse(e.data)
    for (const k of Object.keys(activity)) delete activity[k]
    Object.assign(activity, d.activity || {})
    loadAll()
  })
  es.addEventListener('note', (e) => {
    const n = JSON.parse(e.data)
    const prev = notes.find((x) => x.id === n.id)
    if (prev && prev.status !== n.status && ['done', 'failed', 'handoff'].includes(n.status)) toast(n)
    upsert(n)
    render()
    if (panelId === n.id) {
      if (!VISIBLE.includes(n.status)) closePanel()
      else refreshPanel()
    }
  })
  es.addEventListener('activity', (e) => {
    const { id, text } = JSON.parse(e.data)
    if (text) activity[id] = text
    else delete activity[id]
    render()
    const line = panelId === id && root.querySelector('.panel .act')
    if (line && text) line.textContent = text
  })
  es.addEventListener('reload', () => reload())
  es.onerror = () => {
    online = false
    render()
  }

  /** Closes every open card: the note being written, the panel, the list. */
  function closeAll() {
    root.querySelector('.form')?.remove()
    closePanel()
    list.hidden = true
  }

  /** Bottom-right notice when a note finishes; a click opens its panel. Stays while hovered. */
  function toast(n) {
    const close = () => t.remove()
    const what = n.status === 'done' ? n.summary || n.text : n.status === 'handoff' ? T.take(n.id) : n.text
    const t = h(
      `div.toast.ui.s-${n.status}`,
      {
        onclick: (e) => {
          e.stopPropagation()
          close()
          openPanel(n.id)
        },
      },
      h('b', { text: n.page === page ? T.st[n.status] : `${T.st[n.status]} · ${n.page}` }),
      h('p', { text: short(what, 220) }),
      n.status === 'done' && n.costUsd ? h('small', { text: T.cost(n) }) : null,
      h('button', { text: '×', title: T.close, onclick: (e) => (e.stopPropagation(), close()) }),
    )
    toasts.append(t)
    let timer
    const arm = () => (timer = setTimeout(close, 12000))
    t.addEventListener('mouseenter', () => clearTimeout(timer))
    t.addEventListener('mouseleave', arm)
    arm()
  }

  // --- note mode.
  const setOn = (v) => {
    on = v
    if (!on) hl.style.display = 'none'
    document.documentElement.style.cursor = on ? 'crosshair' : ''
    render()
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (on) return setOn(false)
    list.hidden = !list.hidden
    if (!list.hidden) {
      renderList()
      setOn(true)
    }
  })

  const fromUs = (e) => e.composedPath().includes(host)
  const typing = (e) => {
    const t = e.composedPath()[0]
    return t && t.nodeType === 1 && (t.closest('textarea,input,select,[contenteditable=""],[contenteditable=true]') || t.isContentEditable)
  }
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyN' && e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      return setOn(!on)
    }
    if (e.key === 'Escape') {
      const open = root.querySelector('.form') || panelId || !list.hidden
      closeAll()
      if (!open && on) setOn(false)
      return
    }
    if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'n' || e.key === 'N') setOn(!on)
  })
  document.addEventListener(
    'mouseover',
    (e) => {
      if (!on) return
      if (fromUs(e)) return void (hl.style.display = 'none')
      target = e.target
      const r = target.getBoundingClientRect()
      Object.assign(hl.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
    },
    true,
  )
  document.addEventListener(
    'click',
    (e) => {
      if (fromUs(e)) return
      // A click outside closes whatever is open. If a card was open, the click only closes it.
      const card = root.querySelector('.form') || panelId
      closeAll()
      if (!on) return
      e.preventDefault()
      e.stopPropagation()
      if (card) return
      const el = e.target
      hl.style.display = 'none'
      const r = el.getBoundingClientRect()
      const at = {
        page,
        url: location.href,
        selector: sel(el),
        element: textOf(el),
        html: el.outerHTML.slice(0, 1500),
        styles: stylesOf(el),
        fx: r.width ? (e.clientX - r.left) / r.width : 0,
        fy: r.height ? (e.clientY - r.top) / r.height : 0,
        pageX: e.pageX,
        pageY: e.pageY,
        viewport: `${innerWidth}x${innerHeight}`,
      }
      writeNote(at, e.clientX, e.clientY)
    },
    true,
  )

  /** A card with a textarea: Enter submits, Shift+Enter breaks the line, Esc closes. */
  function textBox(placeholder, onSubmit, onEscape) {
    const ta = h('textarea', { placeholder })
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        onSubmit(ta.value.trim())
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onEscape()
      }
    })
    return ta
  }

  function writeNote(at, x, y) {
    closePanel()
    const close = () => form.remove()
    const save = async (text) => {
      if (!text) return close()
      try {
        const n = await api('/notes', { method: 'POST', body: { ...at, text } })
        upsert(n)
        close()
        render()
      } catch (err) {
        form.querySelector('.err')?.remove()
        form.append(h('p.err', { text: err.message }))
      }
    }
    const ta = textBox(T.write, save, close)
    const form = h(
      'div.card.form.ui',
      {},
      ta,
      h('div.row', {}, h('button', { text: T.cancel, onclick: close }), h('button.ok', { text: T.save, onclick: () => save(ta.value.trim()) })),
    )
    form.style.left = `${Math.max(8, Math.min(x, innerWidth - 330))}px`
    form.style.top = `${Math.max(8, Math.min(y + 18, innerHeight - 190))}px`
    root.append(form)
    ta.focus()
  }

  // --- the panel on a pin.
  function closePanel() {
    root.querySelector('.panel')?.remove()
    panelId = null
  }

  async function openPanel(id) {
    root.querySelector('.form')?.remove()
    closePanel()
    panelId = id
    await refreshPanel()
  }

  let refreshing = null
  async function refreshPanel() {
    const id = panelId
    if (!id) return
    // Don't throw away what the reviewer is typing: keep the text and the focus across a redraw.
    const old = root.querySelector('.panel')
    const oldTa = old && old.querySelector('textarea')
    const draft = oldTa ? oldTa.value : ''
    const focused = oldTa && root.activeElement === oldTa
    const err = old && old.querySelector('.err')?.textContent
    const openDiff = old && old.querySelector('details')?.open
    const req = (refreshing = api(`/notes/${id}`).catch(() => null))
    const n = await req
    if (refreshing !== req || panelId !== id) return
    if (!n) return closePanel()
    const panel = buildPanel(n)
    const ta = panel.querySelector('textarea')
    if (ta && draft) ta.value = draft
    if (err) panel.querySelector('.row')?.before(h('p.err', { text: err }))
    if (openDiff && panel.querySelector('details')) panel.querySelector('details').open = true
    root.querySelector('.panel')?.remove()
    root.append(panel)
    const pin = [...pins.children].find((p) => p.dataset.id === id)
    if (pin) position(panel, pin.getBoundingClientRect())
    else {
      position(panel, { left: innerWidth - 16, right: innerWidth - 16, top: innerHeight })
      panel.style.top = `${Math.max(8, innerHeight - panel.offsetHeight - 72)}px` // above the button
    }
    if (ta && (focused || n.status === 'asking')) ta.focus()
  }

  function diffView(diff) {
    const pre = h('pre')
    for (const line of diff.split('\n')) {
      const c = line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') ? 'h' : line.startsWith('+') ? 'a' : line.startsWith('-') ? 'd' : ''
      pre.append(c ? h(`span.${c}`, { text: line }) : line, '\n')
    }
    return pre
  }

  function shotsView(shots) {
    const before = shots.before || []
    const after = shots.after || []
    if (!before.length && !after.length) return null
    const img = (f) => (f ? h('a', { href: `${API}/shots/${f}`, target: '_blank', rel: 'noopener' }, h('img', { src: `${API}/shots/${f}`, loading: 'lazy', alt: '' })) : h('div'))
    const rows = []
    for (let i = 0; i < Math.max(before.length, after.length); i++) rows.push(img(before[i]), img(after[i]))
    return h('div.shots', {}, h('h5', { text: T.before }), h('h5', { text: T.after }), rows)
  }

  function buildPanel(n) {
    const act = (fn) => async (e) => {
      const b = e.currentTarget
      b.disabled = true
      try {
        await fn()
      } catch (err) {
        const p = root.querySelector('.panel')
        p?.querySelector('.err')?.remove()
        p?.querySelector('.row')?.before(h('p.err', { text: err.message }))
      } finally {
        b.disabled = false
      }
    }
    const post = (what, body) => api(`/notes/${n.id}/${what}`, { method: 'POST', body: body || {} })
    const send = async (text) => {
      if (!text) return
      await post('reply', { text })
      const ta = root.querySelector('.panel textarea')
      if (ta) ta.value = ''
    }

    const del = h('button.del', {
      text: T.del,
      onclick: act(async () => {
        if (!del.dataset.sure) {
          del.dataset.sure = '1'
          del.textContent = T.sure
          return
        }
        await api(`/notes/${n.id}`, { method: 'DELETE' })
        closePanel()
      }),
    })

    const running = ['queued', 'planning', 'working'].includes(n.status)
    const buttons = [del]
    if (n.status === 'done') {
      if (n.files && n.files.length) buttons.push(h('button', { text: T.undo, onclick: act(() => post('undo')) }))
      buttons.push(h('button.ok', { text: T.archive, onclick: act(() => post('archive')) }))
    }
    if (n.status === 'failed') buttons.push(h('button.ok', { text: T.retry, onclick: act(() => post('retry')) }))
    if (!['handoff', 'done'].includes(n.status)) buttons.push(h('button', { text: T.handoff, onclick: act(() => post('handoff')) }))

    let box = null
    if (!running) {
      const ph = n.status === 'asking' ? T.answer : T.follow
      box = textBox(ph, (text) => act(() => send(text))({ currentTarget: box }), closePanel)
      buttons.push(h('button.ok', { text: n.status === 'asking' ? T.reply : T.send, onclick: act(() => send(box.value.trim())) }))
    }

    const who = { user: T.you, agent: T.agent, system: T.system }
    return h(
      `div.card.panel.ui.s-${n.status}`,
      { 'data-id': n.id, onclick: (e) => e.stopPropagation() },
      h(
        'div.head',
        {},
        h('b', { text: n.page === page ? String(numberOf(n.id) || '•') : '•' }),
        h('span', { text: T.st[n.status] }),
        h('small', { text: n.id }),
        h('button', { text: '×', title: T.close, onclick: closePanel }),
      ),
      (n.messages || []).map((m) => h(`p.msg.${m.role}`, {}, h('em', { text: who[m.role] || m.role }), m.text)),
      running ? h('div.act', { text: activity[n.id] || n.activity || T.st[n.status] }) : null,
      n.status === 'handoff' ? h('p.hint', { text: T.take(n.id) }) : null,
      n.diff ? h('details', {}, h('summary', { text: T.changes((n.files || []).length) }), diffView(n.diff)) : null,
      shotsView(n.shots || {}),
      box,
      h('div.row', {}, buttons),
      n.costUsd ? h('div.cost', { text: T.cost(n) }) : null,
    )
  }

  addEventListener('resize', place)
  addEventListener('scroll', () => requestAnimationFrame(place), { passive: true, capture: true })
  addEventListener('load', place)
  setInterval(place, 1000)
  render()

  // --- reloads (ours after a rebuild, or the dev server's HMR): back at the same scroll, mode and panel.
  try {
    const saved = JSON.parse(sessionStorage.getItem('pw-state') || 'null')
    sessionStorage.removeItem('pw-state')
    const nav = performance.getEntriesByType('navigation')[0]
    if (saved && saved.path === location.pathname + location.search && (!nav || nav.type === 'reload')) {
      const back = () => scrollTo(0, saved.y)
      document.readyState === 'complete' ? back() : addEventListener('load', back)
      setTimeout(back, 300)
      if (saved.on) setTimeout(() => setOn(true), 50)
      if (saved.panel) setTimeout(() => openPanel(saved.panel), 300)
    }
  } catch {}
  addEventListener('pagehide', () => {
    try {
      sessionStorage.setItem('pw-state', JSON.stringify({ path: location.pathname + location.search, y: scrollY, on, panel: panelId }))
    } catch {}
  })
  let pending = false
  function reload() {
    const busy = root.querySelector('.form') || [...root.querySelectorAll('textarea')].some((t) => t.value.trim())
    if (busy) return void (pending = true)
    location.reload()
  }
  setInterval(() => pending && reload(), 1000)
})()
