// Feedback overlay, injected by server.mjs. "N" or the button toggles note mode; a click drops
// a numbered pin and asks for the text. Pins follow their element (selector + offset in it).
;(() => {
  const css = `
  .zn-layer{position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483640}
  .zn-layer>*{pointer-events:auto}
  .zn-kbd{font:600 11px system-ui;opacity:.75;margin-left:6px}
  .zn-btn{position:fixed;right:16px;bottom:16px;z-index:2147483646;display:flex;gap:8px;align-items:center;padding:12px 16px;border:0;border-radius:999px;background:#ff3b6b;color:#fff;font:700 14px system-ui;box-shadow:0 10px 30px rgb(0 0 0/.3);cursor:pointer}
  .zn-btn[data-on]{background:#121318;outline:3px solid #ff3b6b}
  .zn-list{position:fixed;right:16px;bottom:72px;z-index:2147483646;width:320px;max-height:50vh;overflow:auto;padding:10px;border-radius:16px;background:#fff;color:#121318;font:14px/1.4 system-ui;box-shadow:0 20px 50px rgb(0 0 0/.3)}
  .zn-list[hidden]{display:none}
  .zn-list li{display:flex;gap:8px;align-items:flex-start;padding:8px;border-radius:10px;list-style:none;cursor:pointer}
  .zn-list li:hover{background:#f1f2f5}
  .zn-list ol{margin:0;padding:0}
  .zn-list b{flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#ff3b6b;color:#fff;font-size:12px}
  .zn-list span{flex:1;white-space:pre-wrap}
  .zn-list button{border:0;background:none;color:#999;cursor:pointer;font-size:16px}
  .zn-pin{position:fixed;z-index:2147483645;display:grid;place-items:center;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50% 50% 50% 0;background:#ff3b6b;color:#fff;font:800 13px system-ui;box-shadow:0 4px 12px rgb(0 0 0/.35);cursor:pointer;transform:rotate(-45deg)}
  .zn-pin i{font-style:normal;transform:rotate(45deg)}
  .zn-pin:hover::after{content:attr(data-text);position:absolute;left:34px;top:0;width:max-content;max-width:260px;padding:8px 10px;border-radius:10px;background:#121318;color:#fff;font:500 13px/1.35 system-ui;white-space:pre-wrap;transform:rotate(45deg);transform-origin:0 0}
  .zn-pin.busy{background:#7a5cff}
  .zn-pin.busy::before{content:"";position:absolute;inset:-6px;border-radius:50%;border:3px solid #7a5cff;border-top-color:transparent;animation:zn-spin .8s linear infinite;transform:rotate(45deg)}
  @keyframes zn-spin{to{transform:rotate(405deg)}}
  .zn-list li.busy b{background:#7a5cff}
  .zn-list li.busy span::after{content:"  · ci sto lavorando…";color:#7a5cff;font-weight:600}
  .zn-pin.ask{background:#12a9c8;animation:zn-bounce 1.4s ease-in-out infinite}
  .zn-pin.ask i::after{content:"?";margin-left:1px}
  @keyframes zn-bounce{50%{transform:rotate(-45deg) translate(3px,-3px)}}
  .zn-list li.ask b{background:#12a9c8}
  .zn-chat{position:fixed;z-index:2147483647;width:340px;padding:14px;border-radius:14px;background:#fff;color:#121318;box-shadow:0 20px 50px rgb(0 0 0/.35);font:14px/1.45 system-ui}
  .zn-chat p{margin:0 0 10px;white-space:pre-wrap}
  .zn-chat .me{color:#5f6474}
  .zn-chat .claude{padding:10px 12px;border-radius:10px;background:#eef1f5}
  .zn-chat .claude b{display:block;margin-bottom:4px;font-size:13px;color:#121318}
  .zn-chat textarea{width:100%;min-height:70px;padding:8px;border:1px solid #ddd;border-radius:8px;font:14px/1.4 system-ui;resize:vertical;box-sizing:border-box}
  .zn-chat div{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
  .zn-chat button{padding:8px 14px;border:0;border-radius:999px;font:700 13px system-ui;cursor:pointer}
  .zn-chat .ok{background:#121318;color:#fff}
  .zn-chat .del{margin-right:auto;background:none;color:#c4243f}
  .zn-chat .del[data-sure]{background:#c4243f;color:#fff}
  .zn-on, .zn-on *{cursor:crosshair!important}
  .zn-hl{outline:2px dashed #ff3b6b!important;outline-offset:2px}
  .zn-form{position:fixed;z-index:2147483647;width:300px;padding:12px;border-radius:14px;background:#fff;box-shadow:0 20px 50px rgb(0 0 0/.35);font:14px system-ui}
  .zn-form textarea{width:100%;min-height:90px;padding:8px;border:1px solid #ddd;border-radius:8px;font:14px/1.4 system-ui;resize:vertical;box-sizing:border-box}
  .zn-form div{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
  .zn-form button{padding:8px 14px;border:0;border-radius:999px;font:700 13px system-ui;cursor:pointer}
  .zn-form .ok{background:#121318;color:#fff}`
  const st = document.createElement('style')
  st.textContent = css
  document.head.append(st)

  const page = location.pathname
  let notes = []
  let lastSig = ''
  let on = false
  let hl = null

  const sel = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`
    const parts = []
    while (el && el !== document.body && parts.length < 8) {
      let s = el.tagName.toLowerCase()
      const cls = [...el.classList].filter((c) => !/^(zn-|in$|out$|live$|astro-)/.test(c)).slice(0, 2)
      if (cls.length) s += `.${cls.map(CSS.escape).join('.')}`
      const p = el.parentElement
      if (p) {
        const same = [...p.children].filter((c) => c.tagName === el.tagName)
        if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`
      }
      parts.unshift(s)
      if (el.id) break
      el = p
    }
    return parts.join(' > ')
  }
  const textOf = (el) => (el.innerText || el.getAttribute('alt') || el.getAttribute('aria-label') || '').trim().slice(0, 120)

  // Everything lives in one popover layer: in the top layer, so it stays above (and usable
  // over) a modal dialog like the contact form. Raised again whenever a dialog opens.
  const layer = document.createElement('div')
  layer.className = 'zn-layer'
  layer.setAttribute('popover', 'manual')
  document.body.append(layer)
  // A modal dialog makes the rest of the page inert: the layer moves inside it while it's open.
  const raise = () => {
    try {
      const modal = [...document.querySelectorAll('dialog[open]')].filter((d) => d.matches(':modal')).at(-1)
      const home = modal ?? document.body
      if (layer.parentElement !== home) home.append(layer)
      if (layer.matches(':popover-open')) layer.hidePopover()
      layer.showPopover()
    } catch {}
  }
  raise()
  new MutationObserver(() => setTimeout(raise, 0)).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] })
  const btn = document.createElement('button')
  btn.className = 'zn-btn'
  const list = document.createElement('div')
  list.className = 'zn-list'
  list.hidden = true
  layer.append(btn, list)

  /** Pins sit on their element, in viewport coordinates: set again on every scroll. */
  function place() {
    for (const pin of layer.querySelectorAll('.zn-pin')) {
      const n = notes.find((x) => x.id === pin.dataset.id)
      if (!n) continue
      const el = n.selector && document.querySelector(n.selector)
      let x = n.pageX - scrollX
      let y = n.pageY - scrollY
      if (el) {
        const r = el.getBoundingClientRect()
        if (r.width || r.height) {
          x = r.left + r.width * n.fx
          y = r.top + r.height * n.fy
        }
      }
      pin.style.left = `${x}px`
      pin.style.top = `${y}px`
    }
  }
  const mine = () => notes.filter((n) => n.page === page && !n.done)
  function render() {
    for (const p of layer.querySelectorAll('.zn-pin')) p.remove()
    const ns = mine()
    const waiting = ns.filter((n) => n.reply && !n.answer).length
    btn.textContent = on ? 'Clicca dove vuoi la nota (Esc o ⌥N per uscire)' : `✎ Note (${ns.length})${waiting ? ` · ${waiting} da rispondere` : ''}`
    on ? btn.setAttribute('data-on', '') : btn.removeAttribute('data-on')
    ns.forEach((n, i) => {
      const pin = document.createElement('div')
      const asks = n.reply && !n.answer
      pin.className = n.working && !asks ? 'zn-pin busy' : asks ? 'zn-pin ask' : 'zn-pin'
      pin.dataset.id = n.id
      pin.dataset.text = asks ? `Claude ti ha risposto: clicca per leggere` : `${n.text}\n\n(clicca per aprire o eliminare)`
      pin.innerHTML = `<i>${i + 1}</i>`
      layer.append(pin)
    })
    place()
    list.innerHTML = ns.length
      ? `<ol>${ns.map((n, i) => `<li data-id="${n.id}" class="${n.reply && !n.answer ? 'ask' : n.working ? 'busy' : ''}"><b>${i + 1}</b><span></span><button title="Elimina" data-del="${n.id}">×</button></li>`).join('')}</ol>`
      : '<p style="margin:6px">Nessuna nota su questa pagina. Premi ⌥N (o N) o il bottone, poi clicca un punto.</p>'
    list.querySelectorAll('li span').forEach((s, i) => (s.textContent = ns[i].text))
  }
  const loadAll = () =>
    fetch('/__notes')
      .then((r) => r.json())
      .then((d) => {
        // Only redraw when something changed, so a pin never vanishes under the pointer.
        const sig = JSON.stringify(d)
        if (sig === lastSig) return
        lastSig = sig
        notes = d
        render()
      })

  const setOn = (v) => {
    on = v
    document.documentElement.classList.toggle('zn-on', on)
    if (!on && hl) hl.classList.remove('zn-hl')
    render()
  }
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    if (on) return setOn(false)
    list.hidden = !list.hidden
    if (!list.hidden) setOn(true)
  })
  list.addEventListener('click', async (e) => {
    e.stopPropagation()
    const del = e.target.closest('[data-del]')
    if (del) {
      await fetch(`/__notes?id=${del.dataset.del}`, { method: 'DELETE' })
      lastSig = ''
      return loadAll()
    }
    const li = e.target.closest('li')
    const pin = li && document.querySelectorAll('.zn-pin')[[...list.querySelectorAll('li')].indexOf(li)]
    pin?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const n = li && notes.find((x) => x.id === li.dataset.id)
    if (pin && n && n.reply) setTimeout(() => thread(n, pin), 400)
  })
  document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyN' && e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      return setOn(!on)
    }
    if (e.target.closest?.('textarea,input')) return
    if (e.key === 'n' || e.key === 'N') setOn(!on)
    if (e.key === 'Escape' && !document.querySelector('.zn-form')) setOn(false)
  })
  document.addEventListener(
    'mouseover',
    (e) => {
      if (!on || e.target.closest('.zn-btn,.zn-list,.zn-form,.zn-pin')) return
      hl?.classList.remove('zn-hl')
      hl = e.target
      hl.classList.add('zn-hl')
    },
    true,
  )
  document.addEventListener(
    'click',
    (e) => {
      if (!on || e.target.closest('.zn-btn,.zn-list,.zn-form,.zn-pin')) return
      e.preventDefault()
      if (document.querySelector('.zn-form')) return e.stopPropagation()
      e.stopPropagation()
      const el = e.target
      el.classList.remove('zn-hl')
      const r = el.getBoundingClientRect()
      const at = {
        page,
        selector: sel(el),
        element: textOf(el),
        fx: r.width ? (e.clientX - r.left) / r.width : 0,
        fy: r.height ? (e.clientY - r.top) / r.height : 0,
        pageX: e.pageX,
        pageY: e.pageY,
        viewport: `${innerWidth}x${innerHeight}`,
        set: document.querySelector('[role=tab][aria-selected=true]')?.textContent.trim() ?? null,
      }
      ask(at, e.clientX, e.clientY)
    },
    true,
  )
  function ask(at, x, y) {
    const f = document.createElement('div')
    f.className = 'zn-form'
    f.style.left = `${Math.max(8, Math.min(x, innerWidth - 320))}px`
    f.style.top = `${Math.min(y + 18, innerHeight - 190)}px`
    f.innerHTML = '<textarea placeholder="Scrivi la nota… (Invio salva, Shift+Invio va a capo)"></textarea><div><button class="no">Annulla</button><button class="ok">Salva</button></div>'
    layer.append(f)
    const ta = f.querySelector('textarea')
    ta.focus()
    const close = () => f.remove()
    const ok = async () => {
      const text = ta.value.trim()
      if (!text) return close()
      await fetch('/__notes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...at, text }) })
      close()
      loadAll()
    }
    f.querySelector('.no').onclick = close
    f.querySelector('.ok').onclick = ok
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        ok()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    })
  }
  document.addEventListener('click', (e) => {
    const pin = e.target.closest('.zn-pin')
    if (!pin) return
    e.preventDefault()
    e.stopPropagation()
    const n = notes.find((x) => x.id === pin.dataset.id)
    if (n) thread(n, pin)
  }, true)
  function thread(n, pin) {
    document.querySelector('.zn-chat')?.remove()
    const r = pin.getBoundingClientRect()
    const c = document.createElement('div')
    c.className = 'zn-chat'
    c.style.left = `${Math.max(8, Math.min(r.left + 20, innerWidth - 360))}px`
    c.style.top = `${Math.min(r.top + 24, innerHeight - 320)}px`
    c.innerHTML = '<p class="me"></p>' + (n.reply ? '<p class="claude"><b>Claude</b><span></span></p>' : '') + (n.answer ? '<p class="me ans"></p>' : '') +
      (n.reply && !n.answer ? '<textarea placeholder="Rispondi… (Invio invia, Shift+Invio va a capo)"></textarea><div><button class="del">Elimina</button><button class="no">Chiudi</button><button class="ok">Rispondi</button></div>' : '<div><button class="del">Elimina</button><button class="no">Chiudi</button></div>')
    c.querySelector('.me').textContent = `Tu: ${n.text}`
    if (n.reply) c.querySelector('.claude span').textContent = n.reply
    if (n.answer) c.querySelector('.ans').textContent = `Tu: ${n.answer}`
    layer.append(c)
    const close = () => c.remove()
    c.querySelector('.no').onclick = close
    // Delete: a second click confirms, so a stray click never loses a note.
    const del = c.querySelector('.del')
    del.onclick = async () => {
      if (!del.dataset.sure) {
        del.dataset.sure = '1'
        del.textContent = 'Sicuro? Elimina'
        return
      }
      await fetch(`/__notes?id=${n.id}`, { method: 'DELETE' })
      close()
      lastSig = ''
      loadAll()
    }
    const ta = c.querySelector('textarea')
    if (!ta) return
    ta.focus()
    const send = async () => {
      const answer = ta.value.trim()
      if (!answer) return
      await fetch(`/__notes?id=${n.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ answer }) })
      close()
      loadAll()
    }
    c.querySelector('.ok').onclick = send
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        send()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
      }
    })
  }
  addEventListener('resize', place)
  addEventListener('scroll', () => requestAnimationFrame(place), { passive: true, capture: true })
  addEventListener('load', place)
  setInterval(loadAll, 2000)
  loadAll()

  // Live reload after each rebuild, back at the same scroll; waits while a note is being written.
  try {
    const y = sessionStorage.getItem('zn-scroll')
    if (y !== null) {
      sessionStorage.removeItem('zn-scroll')
      addEventListener('load', () => scrollTo(0, Number(y)))
      if (sessionStorage.getItem('zn-on')) setTimeout(() => setOn(true), 50)
      sessionStorage.removeItem('zn-on')
    }
  } catch {}
  let pending = false
  const reload = () => {
    if (document.querySelector('.zn-form, .zn-chat textarea')) return (pending = true)
    try {
      sessionStorage.setItem('zn-scroll', String(scrollY))
      if (on) sessionStorage.setItem('zn-on', '1')
    } catch {}
    location.reload()
  }
  setInterval(() => pending && reload(), 1000)
  new EventSource('/__reload').onmessage = reload
})()
