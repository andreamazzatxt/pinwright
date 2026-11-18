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
  const LANG = String(CFG.lang || 'en').slice(0, 2) === 'it' ? 'it' : 'en'
  // Notes only inside these elements (a CSS selector), e.g. one microfrontend's mount point in a shell.
  const SCOPE = typeof CFG.scope === 'string' && CFG.scope.trim() ? CFG.scope.trim() : null
  const inScope = (el) => {
    if (!SCOPE) return true
    try {
      return !!(el && el.closest && (el.closest(SCOPE) || portalOf(el)))
    } catch {
      return true
    }
  }
  /**
   * A modal, menu or tooltip the microfrontend renders through a React portal sits at the end of <body>, outside
   * its mount point, but in React's tree it is still inside: walk the fibers up to an element in scope.
   */
  /** On a layer above the page (a modal, a drawer, a menu, a popover), which may close and take it along. */
  function floats(el) {
    if (el.closest('dialog,[role=dialog],[role=alertdialog],[aria-modal=true],[role=menu],[role=listbox],[popover]')) return true
    if (SCOPE && !el.closest(SCOPE)) return true // a portal of the microfrontend
    for (let node = el; node && node !== document.body; node = node.parentElement) if (getComputedStyle(node).position === 'fixed') return true
    return false
  }
  function portalOf(el) {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
      if (!key) continue
      for (let f = node[key], n = 0; f && n < 5000; f = f.return, n++) {
        const d = f.stateNode
        if (d instanceof Element && d !== node && !node.contains(d) && d.closest(SCOPE)) return true
      }
      return false
    }
    return false
  }
  const tokensOf = (t) => (!t ? '0' : t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : t >= 1e3 ? `${Math.round(t / 1e3)}k` : String(t))
  const T = {
    it: {
      notes: (n) => `Note (${n})`,
      waiting: (n) => ` · ${n} da rispondere`,
      mode: 'Cosa non va? Cliccalo.',
      tap: 'Tocca dove va la nota',
      notesN: (n) => `Note ${n}`,
      write: 'Scrivi la nota…',
      talk: 'Detta: tieni premuto ⌥ o clicca',
      silent: 'Non hai detto niente',
      listening: 'Ti ascolto… rilascia ⌥ per salvare',
      micDenied: 'Microfono bloccato: consentilo dalla barra degli indirizzi.',
      micError: (e) => `Dettatura non riuscita (${e}).`,
      cancel: 'Annulla',
      save: 'Salva',
      close: 'Chiudi',
      stale: 'Ci sono aggiornamenti: clicca per caricarli',
      addOne: 'Aggiungi una nota',
      staleDevtools: 'Ci sono aggiornamenti: clicca per caricarli.\n\nPer averli senza ricaricare, installa o attiva l’estensione React DevTools: senza, questa pagina non può applicare l’HMR del microfrontend.',
      del: 'Elimina',
      sure: 'Sicuro? Elimina',
      reply: 'Rispondi',
      answer: 'Rispondi…',
      follow: 'Non proprio…',
      send: 'Invia',
      archive: 'Archivia',
      undo: 'Annulla modifica',
      retry: 'Riprova',
      handoff: 'Passa a Claude Code',
      changes: (n) => `Modifiche (${n} file)`,
      before: 'Prima',
      after: 'Dopo',
      you: 'Tu',
      agent: 'Claude',
      system: 'pinwright',
      take: (id) => `Da prendere in Claude Code: pinwright take ${id}`,
      empty: 'Nessuna nota. ⌥ + clic o N per aggiungerne.',
      share: 'Vai live',
      sharing: 'Apro il link…',
      shareHint: 'Sito e note con chi ha il link. Max 8 persone.',
      live: 'Live',
      minimize: 'Riduci',
      rename: 'clicca per cambiare nome',
      person: 'clicca per raggiungere o seguire',
      goTo: 'Raggiungi',
      follow: 'Segui',
      unfollow: 'Smetti di seguire',
      following: (n) => `Stai seguendo ${n}`,
      stopHint: 'Esc per smettere',
      expand: 'Espandi',
      yolo: 'YOLO mode',
      linkAutoHint: 'Le note partono subito, senza limiti: chi ha questo link può far girare codice sul tuo computer.',
      linkReviewHint: 'Le note aspettano la tua approvazione.',
      approve: 'Approva',
      discard: 'Scarta',
      awaiting: 'In attesa di approvazione.',
      reviewHost: 'Parte solo se la approvi.',
      toApprove: (n) => ` · ${n} da approvare`,
      copy: 'Copia',
      copied: 'Copiato',
      stopShare: 'Interrompi',
      full: 'Sessione piena (max 8)',
      here: (n) => `${n} qui`,
      other: 'Su altre pagine',
      showDone: (n) => `Mostra fatte (${n})`,
      hideDone: 'Nascondi fatte',
      typing: (n) => `${n} sta scrivendo una nota`,
      hiddenInfo: 'Pin nascosto: lo ritrovi nella lista',
      hiddenTag: 'nascosta',
      unhide: 'Clicca per rimettere il pin',
      offline: 'pinwright non raggiungibile',
      click: 'clicca per aprire',
      cost: (n) => `${n.tokens ? `${tokensOf(n.tokens)} token · ` : ""}$${n.costUsd.toFixed(n.costUsd < 0.01 ? 3 : 2)}`,
      st: { review: 'Da approvare', queued: 'In coda', planning: 'Pianifica', working: 'Ci lavora', done: 'Fatto', asking: 'Domanda', handoff: 'A mano', failed: 'Fallita' },
    },
    en: {
      notes: (n) => `Notes (${n})`,
      waiting: (n) => ` · ${n} to answer`,
      mode: 'What’s off? Click it.',
      tap: 'Tap where the note goes',
      notesN: (n) => `Notes ${n}`,
      write: 'Write the note…',
      talk: 'Dictate: hold ⌥ or click',
      silent: 'You didn’t say anything',
      listening: 'Listening… let go of ⌥ to save',
      micDenied: 'Microphone blocked: allow it from the address bar.',
      micError: (e) => `Dictation failed (${e}).`,
      cancel: 'Cancel',
      save: 'Save',
      close: 'Close',
      stale: 'New changes: click to load them',
      addOne: 'Add a note',
      staleDevtools: 'New changes: click to load them.\n\nTo get them without a reload, install or enable the React DevTools extension: without it this page can’t apply the microfrontend’s hot updates.',
      del: 'Delete',
      sure: 'Sure? Delete',
      reply: 'Reply',
      answer: 'Answer…',
      follow: 'Not quite…',
      send: 'Send',
      archive: 'Archive',
      undo: 'Undo change',
      retry: 'Retry',
      handoff: 'Hand off to Claude Code',
      changes: (n) => `Changes (${n} file${n === 1 ? '' : 's'})`,
      before: 'Before',
      after: 'After',
      you: 'You',
      agent: 'Claude',
      system: 'pinwright',
      take: (id) => `Take it in Claude Code: pinwright take ${id}`,
      empty: 'No notes. ⌥ + click or N to add one.',
      share: 'Go live',
      sharing: 'Opening the link…',
      shareHint: 'Site and notes, for whoever has the link. Max 8 people.',
      live: 'Live',
      minimize: 'Minimize',
      rename: 'click to change your name',
      person: 'click to go to them or follow',
      goTo: 'Go to',
      follow: 'Follow',
      unfollow: 'Stop following',
      following: (n) => `Following ${n}`,
      stopHint: 'Esc to stop',
      expand: 'Expand',
      yolo: 'YOLO mode',
      linkAutoHint: 'Notes run right away, no limits: whoever has this link can run code on your machine.',
      linkReviewHint: 'Notes wait for your approval.',
      approve: 'Approve',
      discard: 'Discard',
      awaiting: 'Waiting for approval.',
      reviewHost: 'Runs only once you approve it.',
      toApprove: (n) => ` · ${n} to approve`,
      copy: 'Copy',
      copied: 'Copied',
      stopShare: 'Stop',
      full: 'Session full (max 8)',
      here: (n) => `${n} here`,
      other: 'On other pages',
      showDone: (n) => `Show done (${n})`,
      hideDone: 'Hide done',
      typing: (n) => `${n} is writing a note`,
      hiddenInfo: 'Pin hidden: it’s in the list',
      hiddenTag: 'hidden',
      unhide: 'Click to put the pin back',
      offline: 'pinwright not reachable',
      click: 'click to open',
      cost: (n) => `${n.tokens ? `${tokensOf(n.tokens)} tokens · ` : ""}$${n.costUsd.toFixed(n.costUsd < 0.01 ? 3 : 2)}`,
      st: { review: 'To approve', queued: 'Queued', planning: 'Planning', working: 'Working', done: 'Done', asking: 'Question', handoff: 'Hand off', failed: 'Failed' },
    },
  }[LANG]

  const css = `
  *{box-sizing:border-box}
  .ui{pointer-events:auto;cursor:default;font:14px/1.45 system-ui,-apple-system,sans-serif;color:#121318;letter-spacing:normal;text-transform:none;text-align:left}
  button{font:700 13px system-ui,-apple-system,sans-serif;cursor:pointer}
  button.ui{cursor:pointer}
  input,textarea{cursor:text}
  .dock{position:fixed;right:16px;bottom:16px;display:flex;gap:8px;align-items:flex-end}
  .dock .people{align-self:flex-end;padding-bottom:7px}
  button.ib.stale{width:44px;height:44px;margin-bottom:2px;background:#fff;box-shadow:0 10px 30px rgb(0 0 0/.3);animation:pop .18s ease-out}
  button.ib.stale svg{width:20px;height:20px}
  button.ib.stale::before{content:"";position:absolute;top:2px;right:2px;width:10px;height:10px;border-radius:50%;background:#ff3b6b;border:2px solid #fff}
  button.ib.stale[hidden]{display:none}
  button.ib.addone{width:32px;height:40px;margin-bottom:3.5px;padding:0;background:none;border:0;border-radius:0;outline:none;-webkit-tap-highlight-color:transparent}
  button.ib.addone:focus-visible .shape{box-shadow:0 0 0 2px #fff,0 0 0 4px var(--pc,#ff3b6b),0 4px 12px rgb(0 0 0/.35)}
  button.ib.addone .shape{display:grid;place-items:center;width:30px;height:30px;margin-top:6px;border-radius:50% 50% 50% 0;background:var(--pc,#ff3b6b);color:#fff;box-shadow:0 4px 12px rgb(0 0 0/.35);transform:rotate(-45deg);transition:translate .34s cubic-bezier(.2,.8,.2,1)}
  button.ib.addone[data-on] .shape{translate:0 -3px}
  button.ib.addone .shape i{position:relative;width:12px;height:12px;transform:rotate(45deg)}
  button.ib.addone .shape i::before,button.ib.addone .shape i::after{content:"";position:absolute;left:5px;top:0;width:2.5px;height:12px;border-radius:2px;background:#fff}
  button.ib.addone .shape i::after{transform:rotate(90deg)}
  button.ib.addone:hover .shape{filter:brightness(1.1)}
  button.ib.stale[data-tip]:hover::after{width:260px;padding:8px 10px;white-space:pre-line;font:500 12px/1.4 system-ui,sans-serif}
  .hiddenchip{position:absolute;right:0;bottom:calc(100% + 8px);display:flex;align-items:center;gap:8px;padding:6px 12px 6px 8px;border:0;border-radius:999px;background:#fff;color:#121318;font:600 12px system-ui,sans-serif;white-space:nowrap;box-shadow:0 6px 18px rgb(0 0 0/.2);transition:opacity .25s ease,translate .25s ease}
  .hiddenchip[data-away]{opacity:0;translate:0 6px;pointer-events:none}
  .list li.hid{opacity:.55}
  .list li.hid:hover{opacity:1}
  .hiddenchip[hidden]{display:none}
  .hiddenchip i{width:14px;height:14px;border-radius:50% 50% 50% 0;background:#16a34a;transform:rotate(-45deg);opacity:.55}
  .hiddenchip:hover{background:#eef1f5}
  .people{display:flex}
  .people span{display:grid;place-items:center;width:30px;height:30px;margin-left:-6px;border:2px solid #fff;border-radius:50%;background:var(--pc);color:#fff;font:800 11px system-ui,sans-serif;box-shadow:0 4px 12px rgb(0 0 0/.2)}
  .people span.me{cursor:pointer;outline:2px solid var(--pc);outline-offset:1px}
  .people span:not(.me){cursor:pointer}
  .people span.followed{outline:2px dashed var(--pc);outline-offset:2px}
  .card.personcard{width:auto;min-width:200px;padding:10px;border-radius:12px}
  .personcard p{display:flex;align-items:center;gap:8px;margin:0 0 8px;color:#121318;font:600 13px system-ui,sans-serif}
  .personcard p i{width:10px;height:10px;border-radius:50%;background:var(--pc)}
  .personcard .row{margin:0;justify-content:stretch}
  .personcard .row button{flex:1}
  .followframe{position:fixed;inset:0;border:3px solid var(--pc);pointer-events:none}
  .followframe button{position:absolute;top:8px;left:50%;translate:-50% 0;padding:5px 12px;border:0;border-radius:999px;background:var(--pc);color:#fff;font:600 12px system-ui,sans-serif;pointer-events:auto;box-shadow:0 6px 18px rgb(0 0 0/.25)}
  .followframe button small{margin-left:6px;opacity:.8;font-weight:500}
  /* The hub: a pill when closed, the dark notes card when open; one element, morphing between the two. */
  .hub{position:relative;display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-end;border-radius:22px;background:#ff3b6b;color:#fff;box-shadow:0 10px 30px rgb(0 0 0/.3);transition:width .34s cubic-bezier(.2,.8,.2,1),height .34s cubic-bezier(.2,.8,.2,1),border-radius .34s ease,background-color .34s ease}
  .hub[data-on],.hub[data-open]{background:#121318}
  .hub[data-open]{border-radius:16px}
  .hub[data-on]:not([data-open]){outline:3px solid #ff3b6b}
  .hub[data-off]{background:#8a8f9c}
  .hub[data-morph]{overflow:hidden}
  .hub[data-yolo]::before{content:"";position:absolute;inset:-2px;padding:2px;border-radius:inherit;background:conic-gradient(from var(--a,0deg),#ff3b6b,#f59e0b,#16a34a,#12a9c8,#7a5cff,#db2777,#ff3b6b);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
  .hub[data-yolo]::after{content:"";position:absolute;inset:-2px;padding:2px;border-radius:inherit;background:radial-gradient(circle 70px at var(--mx,50%) var(--my,50%),#fff,transparent 70%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
  .face{display:flex;align-items:center;gap:8px;padding:12px 16px;white-space:nowrap;font:700 14px system-ui,-apple-system,sans-serif;cursor:pointer;animation:fade .2s ease .1s both}
  .face[hidden],.list[hidden],.toasts[hidden]{display:none}
  .face .n{display:grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:rgb(255 255 255/.25);font-size:11px}
  .face .n.q{background:#12a9c8}
  .face .n.a{background:#b45309}
  .face .lv{display:flex;align-items:center;gap:6px;padding-left:8px;border-left:1px solid rgb(255 255 255/.3);font-size:12px}
  .face .lv i{width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 3px rgb(74 222 128/.25)}
  .face .lv button{display:grid;place-items:center;width:22px;height:22px;padding:0;border:0;border-radius:50%;background:rgb(255 255 255/.18);color:#fff}
  .face .lv svg{width:12px;height:12px}
  .face .golive{display:flex;align-items:center;gap:5px;margin-left:4px;padding:4px 10px;border:0;border-radius:999px;background:rgb(255 255 255/.18);color:#fff;font:700 12px system-ui,sans-serif}
  .face .golive:hover{background:rgb(255 255 255/.3)}
  .face .golive svg{width:12px;height:12px}
  @keyframes fade{from{opacity:0}}
  kbd{margin-left:8px;padding:1px 6px;border:1px solid rgb(255 255 255/.25);border-radius:5px;font:600 10px ui-monospace,monospace;color:rgb(255 255 255/.6);vertical-align:1px}
  .list{width:340px;max-height:60vh;overflow:auto;padding:6px 10px 10px;color:#e8e9ee;animation:fade .2s ease .12s both}
  .list .bar{display:flex;align-items:center;gap:8px;margin:2px 0 6px;padding:6px 4px 6px 6px;font-size:12px;font-weight:600;color:#a3a8b5}
  .list .bar span{flex:1}
  .list .bar button{display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:50%;background:none;color:#a3a8b5;font-size:16px;line-height:1}
  .list .bar button:hover{background:#2a2d36;color:#fff}
  .list ol{margin:0;padding:0}
  .list li{display:flex;gap:8px;align-items:flex-start;padding:8px;border-radius:10px;list-style:none;cursor:pointer}
  .list li:hover{background:#1f2129}
  .list li b{flex:none;display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--c);color:#fff;font-size:12px}
  .list li small{filter:brightness(1.35)}
  .list li span{flex:1;white-space:pre-wrap;overflow-wrap:anywhere}
  .list li small{flex:none;color:var(--c);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.04em;padding-top:3px}
  .list h4{margin:10px 8px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#8a8f9c}
  .list p{margin:6px}
  .list em.cost{display:block;margin-top:2px;font-style:normal;color:#8a8f9c;font-size:12px}
  .share{margin:0 0 8px;padding:10px;border-radius:10px;background:#1c1e25}
  .share p{margin:0 0 8px;color:#a3a8b5;font-size:12px}
  .share input{width:100%;padding:6px 8px;border:1px solid #2a2d36;border-radius:6px;font:12px ui-monospace,monospace;color:#d6d8de;background:#0f1117}
  .share .row{margin-top:6px}
  .share .sw{display:flex;align-items:center;gap:8px;margin:0 0 4px;padding:0;border:0;background:none;color:#fff;font-size:13px;text-align:left}
  .share .sw i{flex:none;position:relative;width:30px;height:18px;border-radius:999px;background:#3a3d47;transition:background .15s}
  .share .sw i::after{content:"";position:absolute;left:2px;top:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgb(0 0 0/.3);transition:translate .15s}
  .share .sw[aria-checked="true"] i{background:linear-gradient(90deg,#ff3b6b,#f59e0b,#16a34a,#12a9c8,#7a5cff,#db2777,#ff3b6b) 0 0/300% 100%;animation:flow 2.4s linear infinite}
  @keyframes flow{to{background-position:300% 0}}
  @media (prefers-reduced-motion:reduce){.share .sw[aria-checked="true"] i{animation:none}}
  .card.namecard{display:flex;gap:6px;width:260px;padding:8px;border-radius:12px}
  .namecard input{flex:1;min-width:0;padding:6px 8px;border:1px solid #d6d8de;border-radius:8px;font:14px system-ui,sans-serif;color:#121318}
  .namecard button{flex:none;padding:6px 12px;border:0;border-radius:999px;background:#121318;color:#fff}
  button.ib{position:relative;display:grid;place-items:center;width:32px;height:32px;padding:0;border:0;border-radius:50%;background:#eef1f5;color:#121318}
  button.ib svg{width:16px;height:16px}
  button.ib.ok{background:#121318;color:#fff}
  button.ib.del{background:none;color:#c4243f}
  button.ib.del[data-sure]{background:#c4243f;color:#fff}
  button.ib.flat{width:26px;height:26px;background:none;color:#5f6474}
  button.ib.flat:hover{background:#e3e5ea}
  button.ib.sm{width:24px;height:24px}
  button.ib.sm svg{width:13px;height:13px}
  button.ib[data-tip]:hover::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 6px);right:0;padding:4px 8px;border-radius:6px;background:#121318;color:#fff;font:600 11px system-ui,sans-serif;white-space:nowrap;pointer-events:none;z-index:2}
  button.ib.del[data-tip]:hover::after{right:auto;left:0}
  .share .top button.ib[data-tip]:hover::after{bottom:auto;top:calc(100% + 6px)}
  .list button.ib.ok{background:#fff;color:#121318}
  .list button.ib.flat{color:#a3a8b5}
  .list button.ib.flat:hover{background:#2a2d36;color:#fff}
  .list button.ib[data-tip]:hover::after{background:#fff;color:#121318}
  .list .err{color:#ff6b81}
  .share .top{display:flex;align-items:center;gap:8px;margin:0 0 6px}
  .share .top b{flex:1;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#a3a8b5}
  .share .top{gap:2px}

  .share .sw[aria-checked="true"] i::after{translate:12px 0}
  .share small{display:block;margin:0 0 8px 38px;color:#a3a8b5;font-size:11px}
  .share .link{display:flex;gap:6px}
  .share .link input{flex:1;min-width:0}
  .cursor{position:fixed;left:0;top:0;pointer-events:none;transition:transform .08s linear;will-change:transform}
  .cursor svg{display:block;filter:drop-shadow(0 1px 2px rgb(0 0 0/.35))}
  .cursor b{position:absolute;left:14px;top:16px;padding:2px 7px;border-radius:999px;background:var(--pc);color:#fff;font:700 11px system-ui,sans-serif;white-space:nowrap}
  .list .toggle{display:block;padding:0;border:0;background:none;color:#a3a8b5;font-size:12px;text-decoration:underline}
  .list .foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:8px 6px 2px}
  .list .live{display:flex;align-items:center;gap:6px;padding:5px 10px 5px 8px;border:0;border-radius:999px;background:#24262e;color:#fff;font-size:12px}
  .list .live:hover{background:#2f323b}
  .list .live svg{width:14px;height:14px}
  .list .live[data-tip]:hover::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 6px);right:0;padding:4px 8px;border-radius:6px;background:#fff;color:#121318;font:600 11px system-ui,sans-serif;white-space:nowrap;pointer-events:none}
  .list .live{position:relative}
  .scope{position:fixed;pointer-events:none;outline:2px solid rgb(255 59 107/.55);outline-offset:-1px;border-radius:4px;box-shadow:0 0 0 9999px rgb(18 19 24/.12);display:none}
  .hl{position:fixed;pointer-events:none;outline:2px dashed #ff3b6b;outline-offset:2px;border-radius:2px;display:none}
  .pin{position:fixed;display:grid;place-items:center;width:28px;height:28px;margin:-28px 0 0 0;border-radius:50% 50% 50% 0;background:var(--c);color:#fff;font:800 13px system-ui,sans-serif;box-shadow:0 4px 12px rgb(0 0 0/.35);cursor:pointer;transform:rotate(-45deg);transform-origin:0 100%}
  .pin i{font-style:normal;transform:rotate(45deg)}
  .pin:hover::after{content:attr(data-text);position:absolute;left:34px;top:0;width:max-content;max-width:280px;padding:8px 10px;border-radius:10px;background:#121318;color:#fff;font:500 13px/1.35 system-ui,sans-serif;white-space:pre-wrap;transform:rotate(45deg);transform-origin:0 0}
  .s-queued{--c:#ff3b6b}
  .s-review{--c:#b45309}
  .s-planning,.s-working{--c:#7a5cff}
  .s-asking{--c:#12a9c8}
  .s-done{--c:#16a34a}
  .s-failed{--c:#dc2626}
  .s-handoff{--c:#f97316}
  .pin .dots{display:flex;gap:2px}
  .pin.typing{pointer-events:none;opacity:.9}
  .pin[data-pressing]{scale:1.18;transition:scale .55s ease-out}
  .pin.leaving{animation:pin-out .26s ease-in forwards}
  @keyframes pin-out{to{scale:0;opacity:0}}
  @media (prefers-reduced-motion:reduce){.pin[data-pressing]{scale:1;transition:none}.pin.leaving{animation:none;opacity:0}}
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
  .row button:not(.ib){padding:8px 14px;border:0;border-radius:999px;background:#eef1f5;color:#121318}
  .row .ok{background:#121318;color:#fff}
  .form .row .mic{margin-right:auto}
  .row .mic svg{width:16px;height:16px}
  .card[data-shake]{animation:shake .4s ease-in-out}
  @keyframes shake{20%,60%{translate:-6px 0}40%,80%{translate:6px 0}}
  .nudge{position:fixed;z-index:3;translate:-50% 0;padding:6px 12px;border-radius:999px;background:#121318;color:#fff;font-size:12px;white-space:nowrap;box-shadow:0 6px 18px rgb(0 0 0/.25);animation:pop .18s ease-out}
  @keyframes pop{from{opacity:0;translate:-50% -4px}}
  @media (prefers-reduced-motion:reduce){.card[data-shake],.nudge{animation:none}}
  .row .mic[data-on]{background:#c4243f;color:#fff;animation:rec 1.2s ease-in-out infinite}
  @keyframes rec{50%{box-shadow:0 0 0 6px rgb(196 36 63/.2)}}
  @media (prefers-reduced-motion:reduce){.row .mic[data-on]{animation:none}}
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
  .toast{position:relative;padding:10px 32px 10px 14px;border-radius:12px;border:2px solid var(--c);background:#fff;box-shadow:0 12px 32px rgb(0 0 0/.25);cursor:pointer;animation:toast-in .2s ease-out}
  .toast b{display:block;color:var(--c);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  .toast p{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
  .toast small{display:block;margin-top:4px;color:#8a8f9c;font-size:12px}
  .toast button{position:absolute;top:6px;right:8px;border:0;background:none;color:#8a8f9c;font-size:16px;line-height:1}
  @keyframes toast-in{from{opacity:0;translate:0 8px}}
  /* A phone: cards, list and toasts take the width there is. */
  @media (max-width:520px){
    .dock{right:8px;bottom:8px}
    .list{width:calc(100vw - 16px);max-height:65vh}
    .card{left:8px!important;right:8px;width:auto}
    .toasts{right:8px;bottom:64px;width:calc(100vw - 16px)}
  }
  /* No hover: tips would stick after a tap, and iOS zooms into fields under 16px. */
  @media (hover:none){
    button.ib[data-tip]:hover::after,.list .live[data-tip]:hover::after,.pin:hover::after{content:none}
    textarea{font-size:16px}
  }
`

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
  // A React modal (MUI and the like) keeps focus inside itself: when our note box takes it, its focus trap sees the
  // focus leave and pulls it back, and nothing can be typed. It learns that from focusin on the document: keep ours.
  for (const t of ['focusin', 'focusout']) host.addEventListener(t, (e) => e.stopPropagation())
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

  const ICONS = {
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    minus: '<path d="M5 12h14"/>',
    power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>',
    archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
    retry: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
  }
  const svg = (name) => {
    const t = document.createElement('template')
    t.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`
    return t.content.firstChild
  }
  /** An icon button; what it does shows on hover (and to screen readers). */
  const ib = (name, tip, onclick, cls = '') => {
    const b = h(`button.ib${cls}`, { 'data-tip': tip, 'aria-label': tip, onclick }, svg(name))
    b.setIcon = (n) => b.replaceChildren(svg(n))
    return b
  }
  /** Copies, then shows a tick for a moment. */
  const copyIb = (getText, cls = '') => {
    const b = ib(
      'copy',
      T.copy,
      async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(getText())
        } catch {}
        b.setIcon('check')
        b.dataset.tip = T.copied
        setTimeout(() => (b.setIcon('copy'), (b.dataset.tip = T.copy)), 1500)
      },
      cls,
    )
    return b
  }

  /** The path notes, pins and cursors belong to. A single-page app changes it without a reload (see onRoute). */
  let page = location.pathname
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
  /** Notes that finished while this page was open: their green pin stays, for everyone, "Show done" or not. */
  const justDone = new Set()
  const shown = (n) => showDone || n.status !== 'done' || justDone.has(n.id)
  /** Pins put away with a long press, per browser. Their notes stay in the list; the chip above the button brings them back. */
  let hiddenPins = new Set()
  try {
    hiddenPins = new Set(JSON.parse(localStorage.getItem('pw-hidden-pins') || '[]'))
  } catch {}
  const saveHidden = () => {
    try {
      localStorage.setItem('pw-hidden-pins', JSON.stringify([...hiddenPins]))
    } catch {}
  }
  let online = true
  // Live session: me, the others (max 8 people), their cursors, the share link (host only).
  let pid = null
  try {
    pid = sessionStorage.getItem('pw-pid')
    if (!pid) sessionStorage.setItem('pw-pid', (pid = Math.random().toString(36).slice(2, 12)))
  } catch {
    pid = Math.random().toString(36).slice(2, 12)
  }
  let me = null
  let full = false
  let peers = []
  let shareLinks = null
  // Which of the two links the share box shows: the one that waits for my approval, unless YOLO mode is on.
  // YOLO is a per-moment choice: every page load starts with it off.
  let yolo = false

  let access = 'host'
  let sharing = false
  const cursors = new Map()
  // Holding ⌥ is a temporary note mode.
  let held = false
  /** Note mode from the round + button (or a touch screen): one note, then it ends. */
  let oneShot = false
  const active = () => on || held
  // A phone or a tablet: no hover and no ⌥. The button arms one note at a time, and a tap puts it there.
  const coarse = matchMedia('(hover: none) and (pointer: coarse)')
  const touch = () => coarse.matches
  const modeHint = () => (touch() ? [T.tap] : [T.mode, h('kbd', { text: 'esc' })])

  const hl = h('div.hl')
  // Where notes are allowed: outlined, the rest of the page dimmed, while placing a note.
  const scopeFrame = h('div.scope')
  /** One of the microfrontend's portals (a modal, a drawer) is showing, at the end of <body>. */
  function layerOpen(scopeEl) {
    for (const child of document.body.children) {
      if (child === host || child.contains(scopeEl) || !child.getClientRects().length) continue
      for (const el of [child, child.firstElementChild]) if (el && portalOf(el)) return true
    }
    return false
  }
  function drawScope() {
    const el = SCOPE && active() ? (() => { try { return document.querySelector(SCOPE) } catch { return null } })() : null
    const r = el && el.getBoundingClientRect()
    // A drawer or modal of the microfrontend is open on top: it's where notes go now, so no frame across it.
    if (!r || !r.width || layerOpen(el)) return void (scopeFrame.style.display = 'none')
    Object.assign(scopeFrame.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  }
  addEventListener('scroll', () => drawScope(), { capture: true, passive: true })
  addEventListener('resize', () => drawScope())
  const face = h('div.face')
  const list = h('div.list', { hidden: true })
  const hub = h('div.hub.ui', {}, list, face)
  let isOpen = false
  const people = h('div.people.ui')
  /** New code arrived but the page didn't redraw with it: one click reloads (see the hot updates below). */
  const stale = ib('retry', T.stale, () => ((stale.hidden = true), location.reload()), '.stale.ui')
  stale.hidden = true
  // After a pin is put away: where it went, for a few seconds. A click opens the list, where hidden pins are.
  const hiddenChip = h(
    'button.hiddenchip.ui',
    { onclick: (e) => (e.stopPropagation(), (hiddenChip.hidden = true), setOpen(true)) },
    h('i'),
    h('span', { text: T.hiddenInfo }),
  )
  hiddenChip.hidden = true
  let chipTimer = null
  function showChip() {
    clearTimeout(chipTimer)
    hiddenChip.hidden = false
    delete hiddenChip.dataset.away
    chipTimer = setTimeout(() => {
      hiddenChip.dataset.away = ''
      chipTimer = setTimeout(() => (hiddenChip.hidden = true), 300)
    }, 5000)
  }
  // One note and done: arms note mode for a single click on the page, then it ends by itself.
  // Shaped like the notes' pins, in my colour, with a +.
  const addOne = h(
    'button.ib.addone.ui',
    {
      'data-tip': T.addOne,
      'aria-label': T.addOne,
      onclick: (e) => {
        e.stopPropagation()
        // No focus ring left around it after a click: the pin itself shows the state.
        e.currentTarget.blur()
        if (on) return setOn(false)
        oneShot = true
        setOn(true)
      },
    },
    h('span.shape', {}, h('i')),
  )
  const dock = h('div.dock', {}, people, stale, addOne, hub, hiddenChip)
  const pins = h('div')
  const cursorLayer = h('div')
  const toasts = h('div.toasts')
  root.append(scopeFrame, hl, pins, cursorLayer, toasts, dock)

  // The page's own cursor during note mode: a pin in my colour, tip on the hotspot. Needs a light-DOM rule.
  const modeStyle = document.createElement('style')
  document.head.append(modeStyle)
  function modeCursor() {
    const c = (me && me.color) || '#ff3b6b'
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'><path d='M2 24V13A11 11 0 1 1 13 24Z' fill='${c}' stroke='white' stroke-width='2'/></svg>`
    // In a live session my pointer is an arrow in my colour, as the others see it. Not !important: links,
    // fields and the page's own cursors keep theirs.
    const arrow = `<svg xmlns='http://www.w3.org/2000/svg' width='18' height='22' viewBox='0 0 18 22'><path d='M1 1v17l4.5-4.2 3.2 7.2 3-1.3-3.2-7H15z' fill='${c}' stroke='white' stroke-width='1.5' stroke-linejoin='round'/></svg>`
    // Our own cards keep the normal cursor: the pin is only for the page.
    const css = `html[data-pw-live]{cursor:url("data:image/svg+xml,${encodeURIComponent(arrow)}") 1 1,auto}html[data-pw-mode],html[data-pw-mode] *{cursor:url("data:image/svg+xml,${encodeURIComponent(svg)}") 2 24,crosshair!important}html[data-pw-mode] pinwright-root{cursor:default!important}`
      // iOS sends a tap's click only to what looks clickable: during note mode, everything does.
      + (touch() ? 'html[data-pw-mode] *{cursor:pointer!important}' : '')
    if (modeStyle.textContent !== css) modeStyle.textContent = css
  }
  modeCursor()

  const api = async (path, opts = {}) => {
    const r = await fetch(API + path, { ...opts, credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined })
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
  /** A queued note from the review link shows as waiting for approval. */
  const stOf = (n) => (n.status === 'queued' && n.approved === false ? 'review' : n.status)
  const short = (s, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s)

  /** Pins sit on their element, in viewport coordinates: set again on scroll, resize and layout shifts. */
  function place() {
    for (const pin of pins.children) {
      const n = notes.find((x) => x.id === pin.dataset.id)
      if (!n) continue
      const el = findEl(n)
      // Its modal or menu is closed: no pin where it used to be.
      const gone = n.floating && (!el || !el.getClientRects().length)
      pin.style.display = gone ? 'none' : ''
      if (gone) continue
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
    drawScope()
    const all = mine()
    // On the page: what is going on, and at most the five latest done notes, minus the pins put away.
    const latestDone = new Set(
      all
        .filter((n) => n.status === 'done' && shown(n) && !hiddenPins.has(n.id))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, 5)
        .map((n) => n.id),
    )
    const ns = all.filter((n) => shown(n) && !hiddenPins.has(n.id) && (n.status !== 'done' || latestDone.has(n.id)))
    const open = all.filter((n) => n.status !== 'done').length
    const waiting = all.filter((n) => n.status === 'asking').length
    const toApprove = access === 'host' ? visible().filter((n) => stOf(n) === 'review').length : 0
    renderFace(open, waiting, toApprove)
    document.documentElement.toggleAttribute('data-pw-mode', active())
    document.documentElement.toggleAttribute('data-pw-live', Boolean(me && peers.length > 1))
    modeCursor()
    renderPeople()
    hub.toggleAttribute('data-on', on)
    addOne.toggleAttribute('data-on', on && oneShot)
    // My colour, the one my pins and pointer wear for the others.
    addOne.style.setProperty('--pc', (me && me.color) || '#ff3b6b')
    hub.toggleAttribute('data-open', isOpen)
    hub.toggleAttribute('data-off', !online)
    hub.toggleAttribute('data-yolo', Boolean(shareLinks && yolo && me && !me.guest))
    toasts.hidden = isOpen
    // Pins are rebuilt only when what they show changed, so one never vanishes under the pointer.
    const sig = JSON.stringify(ns.map((n) => [n.id, stOf(n), n.text, activity[n.id]]))
    if (pins.dataset.sig !== sig) {
      pins.dataset.sig = sig
      pins.replaceChildren(
        ...ns.map((n) => {
          const i = all.indexOf(n)
          const act = activity[n.id]
          const tip = `${T.st[stOf(n)]}${act ? ` · ${act}` : ''}\n\n${short(n.text, 200)}\n\n(${T.click})`
          const pin = h(
            `div.pin.ui.s-${stOf(n)}`,
            {
              'data-id': n.id,
              'data-text': tip,
              onclick: (e) => {
                e.stopPropagation()
                // The click that ends a long press isn't one.
                if (pin.dataset.held) return void delete pin.dataset.held
                openPanel(n.id)
              },
            },
            busy(n) ? h('i.dots', {}, h('b'), h('b'), h('b')) : h('i', { text: String(i + 1) }),
          )
          holdToHide(pin, n.id)
          return pin

        }),
      )
    }
    place()
    renderList()
  }

  /** Pressing a pin for a moment puts it away. */
  function holdToHide(pin, id) {
    let timer = null
    const cancel = () => clearTimeout(timer)
    pin.addEventListener('pointerdown', (e) => {
      if (e.button) return
      clearTimeout(timer)
        // It swells while held, then shrinks away into its tip.
      pin.dataset.pressing = '1'
      timer = setTimeout(() => {
        pin.dataset.held = '1'
        pin.classList.add('leaving')
        setTimeout(() => {
          hiddenPins.add(id)
          saveHidden()
          render()
          showChip()
        }, 260)
      }, 550)
    })
    for (const t of ['pointerup', 'pointerleave', 'pointercancel'])
      pin.addEventListener(t, () => {
        cancel()
        delete pin.dataset.pressing
      })
    // A long press on a phone would open the context menu.
    pin.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  /** The closed hub: the count, what waits for me, and the live state with a copy button. */
  function renderFace(open, waiting, toApprove) {
    const live = shareLinks && me && !me.guest
    const host = Boolean(me && !me.guest)
    const sig = JSON.stringify([full, online, on, touch(), open, waiting, toApprove, live && yolo, live && shareLinks.auto, host, sharing])
    if (face.dataset.sig === sig) return
    face.dataset.sig = sig
    if (full || !online) return void face.replaceChildren(full ? T.full : T.offline)
    const url = () => (yolo ? shareLinks.auto : shareLinks.review)
    const copy = live
      ? h(
          'button',
          {
            title: T.copy,
            'aria-label': T.copy,
            onclick: async (e) => {
              e.stopPropagation()
              try {
                await navigator.clipboard.writeText(url())
              } catch {}
              copy.replaceChildren(svg('check'))
              setTimeout(() => copy.replaceChildren(svg('copy')), 1500)
            },
          },
          svg('copy'),
        )
      : null
    // Live: the dot and the link to copy. Not yet: Go live right here, without opening the list.
    const liveBit = live
      ? h('span.lv', {}, h('i'), yolo ? 'YOLO' : T.live, copy)
      : host
        ? h('button.golive', { title: T.shareHint, disabled: sharing, onclick: (e) => (e.stopPropagation(), startShare()) }, svg('link'), sharing ? T.sharing : T.share)
        : null
    if (on) return void face.replaceChildren(...modeHint(), ...(liveBit ? [liveBit] : []))
    // replaceChildren would print a null as the text "null".
    face.replaceChildren(
      ...[
        T.notesN(open),
        waiting ? h('span.n.q', { text: String(waiting), title: T.waiting(waiting).replace(' · ', '') }) : null,
        toApprove ? h('span.n.a', { text: String(toApprove), title: T.toApprove(toApprove).replace(' · ', '') }) : null,
        // Not live yet: Go live waits in note mode and in the list, so a click on the button never starts it by mistake.
        live ? liveBit : null,
      ].filter(Boolean),
    )
  }

  /** Opens or closes the hub, morphing size, corners and colour from one state to the other. */
  function setOpen(v) {
    if (v === isOpen) return
    const from = hub.getBoundingClientRect()
    isOpen = v
    list.hidden = !v
    face.hidden = v
    render()
    hub.style.width = ''
    hub.style.height = ''
    const to = hub.getBoundingClientRect()
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    hub.setAttribute('data-morph', '')
    // Back to the old size without animating it (colour and corners keep transitioning), then grow to the new one.
    hub.style.transitionProperty = 'background-color,border-radius'
    hub.style.width = `${from.width}px`
    hub.style.height = `${from.height}px`
    hub.offsetWidth
    hub.style.transitionProperty = ''
    hub.style.width = `${to.width}px`
    hub.style.height = `${to.height}px`
    clearTimeout(hub.morphTimer)
    hub.morphTimer = setTimeout(() => {
      hub.removeAttribute('data-morph')
      hub.style.width = ''
      hub.style.height = ''
    }, 380)
  }

  function renderList() {
    if (!isOpen) return
    const all = mine()
    // Of the done notes, only the three latest: the list is for what is going on.
    const latest = new Set(
      visible()
        .filter((n) => n.status === 'done' && shown(n))
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
        .slice(0, 3)
        .map((n) => n.id),
    )
    // Pins put away live here, whatever their state: this is where they are found again.
    const listed = (n) => hiddenPins.has(n.id) || (shown(n) && (n.status !== 'done' || latest.has(n.id)))
    const ns = all.filter(listed)
    const others = visible().filter((n) => n.page !== page && listed(n))
    const done = visible().filter((n) => n.status === 'done').length
    const item = (n, i, here) =>
      h(
        `li.s-${stOf(n)}${hiddenPins.has(n.id) ? '.hid' : ''}`,
        {
          title: hiddenPins.has(n.id) ? T.unhide : undefined,
          onclick: () => {
            // Clicked in the list: its pin comes back.
            if (hiddenPins.delete(n.id)) saveHidden()
            if (!here) return void (location.href = n.page)
            render()
            focusPin(n.id)
          },
        },
        h('b', { text: here ? String(i + 1) : '•' }),
        h(
          'span',
          {},
          here ? short(n.text) : `${n.page}  ${short(n.text, 80)}`,
          n.status === 'done' && n.costUsd ? h('em.cost', { text: T.cost(n) }) : null,
        ),
        h('small', { text: hiddenPins.has(n.id) ? `${T.st[stOf(n)]} · ${T.hiddenTag}` : T.st[stOf(n)] }),
      )
    const bar = h(
      'div.bar',
      {},
      h('span', {}, on ? modeHint() : T.notesN(all.filter((n) => n.status !== 'done').length)),
      h('button', { text: '×', title: T.close, 'aria-label': T.close, onclick: (e) => (e.stopPropagation(), setOn(false), setOpen(false)) }),
    )
    const parts = [
      bar,
      shareBox(),
      ns.length ? h('ol', {}, ns.map((n) => item(n, all.indexOf(n), true))) : null,
      others.length ? [h('h4', { text: T.other }), h('ol', {}, others.map((n, i) => item(n, i, false)))] : null,
      h(
        'div.foot',
        {},
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
        : h('span'),
        goLive(),
      ),
    ]
    // replaceChildren would print a null as the text "null".
    list.replaceChildren(...parts.flat().filter(Boolean))
  }

  function initials(name) {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .slice(0, 2)
      .toUpperCase()
  }
  function renderPeople() {
    const sig = JSON.stringify([peers.map((p) => [p.id, p.name]), following])
    if (people.dataset.sig === sig) return
    people.dataset.sig = sig
    // Alone, nothing to show.
    const ps = peers.length > 1 ? peers : []
    people.replaceChildren(
      ...ps.map((p) => {
        const mine = p.id === pid
        const chip = h(mine ? 'span.me' : p.id === following ? 'span.followed' : 'span', {
          title: mine ? `${p.name} (${T.you}) · ${T.rename}` : `${p.name} · ${T.person}`,
          text: initials(p.name),
          onclick: (e) => (e.stopPropagation(), mine ? nameCard(chip) : personCard(chip, p)),
        })
        chip.style.setProperty('--pc', p.color)
        return chip
      }),
    )
  }

  // The YOLO border follows the pointer: the colours turn towards it and a highlight sits where it's nearest.
  let glowFrame = 0
  let lastMove = null
  addEventListener(
    'pointermove',
    (ev) => {
      lastMove = ev
      if (glowFrame) return
      glowFrame = requestAnimationFrame(() => {
        glowFrame = 0
        const e = lastMove
        const box = hub.hasAttribute('data-yolo') ? hub : null
        if (!box) return
        const r = box.getBoundingClientRect()
        const a = (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI + 90
        box.style.setProperty('--a', `${a}deg`)
        box.style.setProperty('--mx', `${Math.max(0, Math.min(r.width, e.clientX - r.left)) + 2}px`)
        box.style.setProperty('--my', `${Math.max(0, Math.min(r.height, e.clientY - r.top)) + 2}px`)
      })
    },
    { passive: true },
  )

  /** A small card above my chip to choose my name; it sticks in this browser. */
  // --- follow: go where someone is, once, or keep going wherever they go (page and scroll) until I move myself.
  let following = null
  try {
    following = sessionStorage.getItem('pw-follow')
  } catch {}
  const followFrame = h('div.followframe', { hidden: true })
  root.append(followFrame)

  /** Someone else's card: go to them, follow them, or stop following. */
  function personCard(chip, p) {
    root.querySelector('.namecard,.personcard')?.remove()
    const close = () => card.remove()
    const isOn = following === p.id
    const card = h(
      'div.card.personcard.ui',
      { onclick: (e) => e.stopPropagation() },
      h('p', {}, h('i'), p.name),
      h(
        'div.row',
        {},
        h('button', { text: T.goTo, onclick: () => (close(), goTo(p.id)) }),
        h('button.ok', { text: isOn ? T.unfollow : T.follow, onclick: () => (close(), isOn ? unfollow() : follow(p.id)) }),
      ),
    )
    card.style.setProperty('--pc', p.color)
    root.append(card)
    const r = chip.getBoundingClientRect()
    card.style.left = `${Math.max(8, Math.min(r.left, innerWidth - card.offsetWidth - 8))}px`
    card.style.top = `${r.top - card.offsetHeight - 8}px`
  }

  /** Brings my view to theirs: their page (a navigation), then their viewport, centred. */
  function catchUp(id, smooth) {
    const d = cursors.get(id)?.data
    const where = d?.page ?? peers.find((x) => x.id === id)?.page
    if (where && where !== page) {
      try {
        if (d && typeof d.sy === 'number') sessionStorage.setItem('pw-goto', JSON.stringify({ path: where, d }))
      } catch {}
      return void (location.href = where)
    }
    if (!d || typeof d.sy !== 'number') return
    scrollTo({ top: Math.max(0, d.sy + (d.vh || innerHeight) / 2 - innerHeight / 2), behavior: smooth ? 'smooth' : 'auto' })
  }

  function goTo(id) {
    if (following && following !== id) unfollow()
    catchUp(id, true)
  }
  function follow(id) {
    following = id
    try {
      sessionStorage.setItem('pw-follow', id)
    } catch {}
    renderFollow()
    catchUp(id, true)
  }
  function unfollow() {
    if (!following) return
    following = null
    try {
      sessionStorage.removeItem('pw-follow')
    } catch {}
    renderFollow()
  }
  /** The frame in their colour, and the pill that says whom I follow (a click stops it). */
  function renderFollow() {
    const p = following && peers.find((x) => x.id === following)
    followFrame.hidden = !p
    if (p) {
      followFrame.style.setProperty('--pc', p.color)
      followFrame.replaceChildren(h('button.ui', { onclick: (e) => (e.stopPropagation(), unfollow()) }, T.following(p.name), h('small', { text: T.stopHint })))
    }
    people.dataset.sig = ''
    renderPeople()
  }
  // Moving myself ends it: the wheel, a touch, the scroll keys.
  const takeOver = () => following && unfollow()
  addEventListener('wheel', takeOver, { passive: true })
  addEventListener('touchmove', takeOver, { passive: true })
  addEventListener('keydown', (e) => {
    if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].includes(e.key) && !typing(e)) takeOver()
  })
  // Where they were when I arrived on their page.
  try {
    const go = JSON.parse(sessionStorage.getItem('pw-goto') || 'null')
    sessionStorage.removeItem('pw-goto')
    if (go && go.path === page) {
      const there = () => scrollTo(0, Math.max(0, go.d.sy + (go.d.vh || innerHeight) / 2 - innerHeight / 2))
      document.readyState === 'complete' ? there() : addEventListener('load', there)
      setTimeout(there, 300)
    }
  } catch {}

  function nameCard(chip) {
    root.querySelector('.namecard,.personcard')?.remove()
    const save = () => {
      const name = input.value.replace(/\s+/g, ' ').trim().slice(0, 30)
      card.remove()
      if (!name || !ws || ws.readyState !== 1) return
      try {
        localStorage.setItem('pw-name', name)
      } catch {}
      ws.send(JSON.stringify({ t: 'name', name }))
    }
    const input = h('input', {
      value: me ? me.name : '',
      maxLength: 30,
      onkeydown: (e) => {
        e.stopPropagation()
        if (e.key === 'Enter') save()
        if (e.key === 'Escape') card.remove()
      },
    })
    const card = h('div.card.namecard.ui', { onclick: (e) => e.stopPropagation() }, input, h('button', { text: T.save, onclick: save }))
    root.append(card)
    const r = chip.getBoundingClientRect()
    card.style.left = `${Math.max(8, Math.min(r.left, innerWidth - card.offsetWidth - 8))}px`
    card.style.top = `${r.top - card.offsetHeight - 8}px`
    input.focus()
    input.select()
  }

  /** The host's two links to the live session, in the list. Guests don't get them. */
  let shareError = null
  async function startShare() {
    if (sharing) return
    sharing = true
    shareError = null
    render()
    try {
      const r = await api('/share', { method: 'POST', body: { page: location.pathname + location.search } })
      shareLinks = r.links
    } catch (err) {
      shareError = err.message
      setOpen(true)
    } finally {
      sharing = false
      render()
    }
  }

  /** Off: just a small button at the bottom of the list. */
  function goLive() {
    if (!me || me.guest || shareLinks) return null
    return h('button.live', { 'data-tip': T.shareHint, disabled: sharing, onclick: (e) => (e.stopPropagation(), startShare()) }, svg('link'), sharing ? T.sharing : T.share)
  }

  function shareBox() {
    if (!me || me.guest) return null
    if (!shareLinks) return shareError ? h('p.err', { text: shareError }) : null
    const url = yolo ? shareLinks.auto : shareLinks.review
    const input = h('input', { value: url, readOnly: true, onclick: (e) => (e.stopPropagation(), e.target.select()) })
    const stop = ib(
      'power',
      T.stopShare,
      async (e) => {
        e.stopPropagation()
        await api('/share', { method: 'DELETE' }).catch(() => {})
        shareLinks = null
        render()
      },
      '.flat',
    )
    const top = h('div.top', {}, h('b', { text: yolo ? `${T.live} · YOLO` : T.live }), stop)
    const toggle = h(
      'button.sw',
      {
        role: 'switch',
        'aria-checked': String(yolo),
        onclick: (e) => {
          e.stopPropagation()
          yolo = !yolo
          render()
        },
      },
      h('i'),
      T.yolo,
    )
    return h(
      'div.share',
      {},
      top,
      toggle,
      h('small', { text: yolo ? T.linkAutoHint : T.linkReviewHint }),
      h('div.link', {}, input, copyIb(() => url, '.ok')),
    )
  }
  function alertIn(box, msg) {
    box.querySelector('.err')?.remove()
    box.prepend(h('p.err', { text: msg }))
  }

  // --- cursors: mine goes out (throttled) anchored to the element under it; the others' come in.
  let lastPointer = null
  /** The note I'm writing, if any: where it goes, so the others see a pin there with dots. */
  let writing = null
  let sendTimer = null
  let lastSent = 0
  function cursorPayload(hidden) {
    // sy, vh: where my viewport is, for whoever follows me.
    const view = { sy: scrollY, vh: innerHeight }
    if (writing) view.w = writing.at
    if (hidden || !lastPointer) return { pid, page, hidden: true, ...view }
    const { x, y } = lastPointer
    const el = document.elementFromPoint(x, y)
    const d = { pid, page, x: x / innerWidth, y: y + scrollY, hidden: false, ...view }
    if (el && el !== host && el !== document.documentElement && el !== document.body) {
      const r = el.getBoundingClientRect()
      if (r.width && r.height) Object.assign(d, { sel: sel(el), fx: (x - r.left) / r.width, fy: (y - r.top) / r.height })
    }
    return d
  }
  function sendCursor(hidden = false) {
    if (!me || peers.length < 2) return
    const go = () => {
      sendTimer = null
      lastSent = Date.now()
      if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'cursor', ...cursorPayload(hidden) }))
    }
    if (hidden) return go()
    if (sendTimer) return
    sendTimer = setTimeout(go, Math.max(0, 60 - (Date.now() - lastSent)))
  }
  // While I write, the others' copy must not go stale (my pointer may not move); a card closed any way ends it.
  setInterval(() => {
    if (writing && !writing.form.isConnected) writing = null
    else if (!writing) return
    sendCursor()
  }, 3000)
  // Followers keep up with my scroll too, not only my pointer.
  addEventListener('scroll', () => sendCursor(), { passive: true })
  addEventListener(
    'pointermove',
    (e) => {
      lastPointer = { x: e.clientX, y: e.clientY }
      sendCursor()
      // The key itself may never reach the page (focus in the address bar, an iframe, a handler that swallows it):
      // the pointer still says whether ⌥ is down.
      const alt = e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey
      if (alt !== held) {
        held = alt
        if (!active()) hl.style.display = 'none'
        render()
      }
      // ⌥'s keyup can be lost (the microphone prompt takes the focus): the pointer tells it's up.
      if (voice && voice.hold && !e.altKey) releaseTalk()
      if (held && !voice && !fromUs(e)) highlight(e.target)
    },
    { passive: true, capture: true },
  )
  document.addEventListener('pointerleave', () => sendCursor(true))
  addEventListener('blur', () => {
    held = false
    render()
  })

  function arrow(color) {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('width', '18')
    svg.setAttribute('height', '22')
    svg.setAttribute('viewBox', '0 0 18 22')
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', 'M1 1v17l4.5-4.2 3.2 7.2 3-1.3-3.2-7H15z')
    path.setAttribute('fill', color)
    path.setAttribute('stroke', '#fff')
    path.setAttribute('stroke-width', '1.5')
    path.setAttribute('stroke-linejoin', 'round')
    svg.append(path)
    return svg
  }
  /** Where a point the others sent lands on my screen: on the same element if I have it, else by page position. */
  function spot(p) {
    let x = p.x * innerWidth
    let y = p.y - scrollY
    if (p.sel) {
      try {
        const el = document.querySelector(p.sel)
        const r = el && el.getBoundingClientRect()
        if (r && (r.width || r.height)) {
          x = r.left + r.width * p.fx
          y = r.top + r.height * p.fy
        }
      } catch {}
    }
    return { x, y }
  }
  function placeCursors() {
    for (const [id, c] of cursors) {
      const d = c.data
      const here = d.page === page && Date.now() - c.at < 20000 && peers.some((p) => p.id === id)
      // Someone writing a note: a pin in their colour where it goes, with dots.
      if (here && d.w) {
        if (!c.wel) {
          c.wel = h('div.pin.typing', { title: T.typing(d.name) }, h('i', {}, h('span.dots', {}, h('b'), h('b'), h('b'))))
          cursorLayer.append(c.wel)
        }
        c.wel.style.setProperty('--c', d.color)
        const { x, y } = spot(d.w)
        Object.assign(c.wel.style, { display: 'grid', left: `${x}px`, top: `${y}px` })
      } else if (c.wel) c.wel.style.display = 'none'
      if (!here || d.hidden) {
        c.el.style.display = 'none'
        continue
      }
      const { x, y } = spot(d)
      c.el.style.display = 'block'
      c.el.style.transform = `translate(${x}px, ${y}px)`
    }
  }
  function onCursor(d) {
    let c = cursors.get(d.pid)
    if (!c) {
      const el = h('div.cursor', {}, arrow(d.color), h('b', { text: d.name }))
      el.style.setProperty('--pc', d.color)
      cursorLayer.append(el)
      c = { el, data: d, at: Date.now() }
      cursors.set(d.pid, c)
    }
    c.data = d
    c.at = Date.now()
    placeCursors()
    if (following === d.pid) catchUp(d.pid, false)
  }
  setInterval(placeCursors, 2000)

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

  // The live channel is a WebSocket: tunnels (the shared link) hold back SSE but pass these through.
  const handlers = {}
  const handle = (event, fn) => (handlers[event] = fn)
  let ws = null
  let retry = 0
  function connect() {
    const u = new URL(`${API}/ws`)
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
    u.searchParams.set('pid', pid)
    u.searchParams.set('page', page)
    try {
      const name = localStorage.getItem('pw-name')
      if (name) u.searchParams.set('name', name)
    } catch {}
    const sock = new WebSocket(u)
    ws = sock
    sock.onopen = () => (retry = 0)
    sock.onmessage = (e) => {
      try {
        const { event, data } = JSON.parse(e.data)
        if (handlers[event]) handlers[event](data)
      } catch {}
    }
    sock.onclose = () => {
      if (ws !== sock) return
      ws = null
      if (full) return
      online = false
      render()
      setTimeout(connect, Math.min(10000, 500 * 2 ** retry++))
    }
  }
  handle('hello', (d) => {
    for (const k of Object.keys(activity)) delete activity[k]
    Object.assign(activity, d.activity || {})
    me = d.me || null
    peers = d.peers || []
    access = d.access || 'host'
    if (d.share) shareLinks = d.share.links
    full = false
    modeCursor()
    loadAll()
  })
  handle('full', () => {
    full = true
    render()
  })
  handle('peers', (d) => {
    peers = d
    me = peers.find((p) => p.id === pid) || me
    for (const [id, c] of cursors) {
      if (!peers.some((p) => p.id === id)) {
        c.el.remove()
        cursors.delete(id)
      }
    }
    if (following && !peers.some((p) => p.id === following)) unfollow()
    else renderFollow()
    render()
    // Somebody new: tell them where my pointer is.
    sendCursor()
  })
  handle('cursor', onCursor)
  handle('share', (d) => {
    shareLinks = d.links
    render()
  })
  handle('note', (n) => {
    const prev = notes.find((x) => x.id === n.id)
    if (prev && prev.status !== 'done' && n.status === 'done') justDone.add(n.id)
    if (prev && prev.status !== n.status && ['done', 'failed', 'handoff'].includes(n.status)) toast(n)
    // The host hears about notes and replies from the review link as they arrive.
    else if (access === 'host' && stOf(n) === 'review' && (!prev || stOf(prev) !== 'review')) toast(n)
    upsert(n)
    render()
    if (panelId === n.id) {
      if (!VISIBLE.includes(n.status)) closePanel()
      else refreshPanel()
    }
  })
  handle('activity', ({ id, text }) => {
    if (text) activity[id] = text
    else delete activity[id]
    render()
    const line = panelId === id && root.querySelector('.panel .act')
    if (line && text) line.textContent = text
  })
  handle('reload', () => reload())
  connect()

  /** Closes every open card: the note being written, the panel, the list. */
  function closeAll() {
    root.querySelector('.form')?.remove()
    root.querySelector('.namecard,.personcard')?.remove()
    closePanel()
    setOpen(false)
  }

  /** Bottom-right notice when a note finishes; a click opens its panel. Stays while hovered. */
  function toast(n) {
    const close = () => t.remove()
    const what = n.status === 'done' ? n.summary || n.text : n.status === 'handoff' ? T.take(n.id) : n.text
    const t = h(
      `div.toast.ui.s-${stOf(n)}`,
      {
        onclick: (e) => {
          e.stopPropagation()
          close()
          openPanel(n.id)
        },
      },
      h('b', { text: n.page === page ? T.st[stOf(n)] : `${T.st[stOf(n)]} · ${n.page}` }),
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
    if (!v) oneShot = false
    if (!active()) hl.style.display = 'none'
    render()
  }
  function highlight(t) {
    if (!t || t === host || !t.getBoundingClientRect) return
    if (!inScope(t)) {
      target = null
      hl.style.display = 'none'
      return
    }
    target = t
    const r = t.getBoundingClientRect()
    Object.assign(hl.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` })
  }
  hub.addEventListener('click', (e) => {
    e.stopPropagation()
    if (isOpen) return
    // First click: note mode, compact, so the page stays visible. A second click opens the list (and Go live).
    if (on) return setOpen(true)
    setOn(true)
  })

  const fromUs = (e) => e.composedPath().includes(host)
  const typing = (e) => {
    const t = e.composedPath()[0]
    return t && t.nodeType === 1 && (t.closest('textarea,input,select,[contenteditable=""],[contenteditable=true]') || t.isContentEditable)
  }
  const isAlt = (e) => e.key === 'Alt' || e.key === 'AltGraph'
  // On window, capturing: the page's own key handlers can't stop these first.
  addEventListener('keyup', (e) => {
    if (isAlt(e)) releaseTalk()
    if (!isAlt(e) || !held) return
    held = false
    if (!active()) hl.style.display = 'none'
    render()
  }, true)
  addEventListener(
    'keydown',
    (e) => {
      // Hold ⌥ (alone): the cursor turns into a pin and a click drops a note.
      if (!isAlt(e) || e.repeat || e.metaKey || e.ctrlKey || e.shiftKey || typing(e)) return
      held = true
      if (lastPointer) {
        const t = document.elementFromPoint(lastPointer.x, lastPointer.y)
        if (t && t !== host) highlight(t)
      }
      render()
    },
    true,
  )
  document.addEventListener('keydown', (e) => {
    if (isAlt(e)) return
    if (e.code === 'KeyN' && e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      return setOn(!on)
    }
    if (e.key === 'Escape') {
      if (following && !root.querySelector('.form')) return void unfollow()
      const open = root.querySelector('.form') || panelId || isOpen
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
      if (!active()) return
      if (fromUs(e)) return void (hl.style.display = 'none')
      highlight(e.target)
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
      // ⌥ held at click time counts even if its keydown never reached the page (focus elsewhere).
      if (!active() && !(e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey)) return
      // Outside the scope the page behaves as usual, so the rest of the app stays usable.
      if (!inScope(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      if (card) return
      const el = e.target
      hl.style.display = 'none'
      // The router may have just moved on, ahead of our check (input runs before timers when the page is busy).
      onRoute()
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
        floating: floats(el),
      }
      // On a touch screen the button gives one note: the next tap is the page's again.
      if ((touch() || oneShot) && on) setOn(false)
      writeNote(at, e.clientX, e.clientY)
    },
    true,
  )
  // In note mode a press on the page is ours: its menus and drags don't start under the note being placed.
  for (const type of ['pointerdown', 'mousedown', 'touchstart'])
    document.addEventListener(
      type,
      (e) => {
        if (!active() || fromUs(e) || !inScope(e.target)) return
        e.stopPropagation()
        // No hover on a touch screen: show what the tap is on as it lands.
        if (type === 'pointerdown' && e.pointerType !== 'mouse') highlight(e.target)
      },
      { capture: true, passive: true },
    )

  // --- dictation: the browser's speech recognition (Chrome, Edge, Safari), into the note being written.
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition
  /** The dictation going on, if any: the box it fills, its recognizer once started, and the ⌥ hold timer. */
  let voice = null

  /** ⌥ went down in a note box (or was still down when it opened): held a moment, it starts dictation. */
  function holdToTalk(ta) {
    if (!Speech || voice) return
    voice = { ta, rec: null, hold: true, timer: setTimeout(() => startVoice(ta, true), 350) }
  }
  /** ⌥ came up, or another key went down with it (⌥ also types characters): no dictation, or the end of it. */
  function releaseTalk() {
    if (!voice) return
    clearTimeout(voice.timer)
    if (voice.rec) voice.rec.stop()
    else voice = null
  }

  /** `hold`: started by holding ⌥, so letting go of ⌥ ends it and saves what was said. */
  function startVoice(ta, hold = false) {
    if (!ta.isConnected) return void (voice = null)
    const rec = new Speech()
    rec.lang = navigator.language || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    voice = { ta, rec, hold, timer: null }
    const mic = ta.parentNode?.querySelector('.mic')
    const placeholder = ta.placeholder
    // What was typed stays; what is said goes after it.
    const base = ta.value.trim() ? `${ta.value.trimEnd()} ` : ''
    /** Whether any words came; what went wrong, if something did (null: nothing to say, e.g. aborted). */
    let spoke = false
    let failed = false
    let problem = null
    rec.onresult = (e) => {
      let said = ''
      for (const r of e.results) said += r[0].transcript
      spoke = spoke || Boolean(said.trim())
      ta.value = base + said.trim()
    }
    rec.onerror = (e) => {
      if (e.error === 'no-speech') return
      failed = true
      if (e.error === 'aborted') return
      problem = e.error === 'not-allowed' || e.error === 'service-not-allowed' ? T.micDenied : T.micError(e.error)
      // Clicked on: the message stays in the card. Held: it comes as a nudge when ⌥ is let go.
      if (hold) return
      ta.parentNode?.querySelector('.err')?.remove()
      ta.parentNode?.append(h('p.err', { text: problem }))
    }
    rec.onend = () => {
      if (voice && voice.rec === rec) voice = null
      if (hold && ta.isConnected) {
        // Push to talk: let go and the note is saved as it is (the final words arrive just before this).
        if (spoke && !failed && ta.submit) return void ta.submit(ta.value.trim())
        if (!failed || problem) nudge(ta.closest('.card'), problem || T.silent)
      }
      mic?.removeAttribute('data-on')
      ta.placeholder = placeholder
      if (ta.isConnected) {
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      }
    }
    mic?.setAttribute('data-on', '')
    ta.placeholder = T.listening
    try {
      rec.start()
    } catch {
      voice = null
      mic?.removeAttribute('data-on')
    }
  }

  /** Nothing to save: the card shakes and says why, just below it, for a moment. */
  function nudge(card, text) {
    if (!card) return
    root.querySelector('.nudge')?.remove()
    // In the shadow root, not the card: a panel scrolls and would clip it.
    const r = card.getBoundingClientRect()
    const below = r.bottom + 44 < innerHeight
    const tip = h('div.nudge', { role: 'status', text })
    tip.style.left = `${r.left + r.width / 2}px`
    tip.style.top = below ? `${r.bottom + 8}px` : `${r.top - 38}px`
    root.append(tip)
    card.removeAttribute('data-shake')
    card.offsetWidth
    card.setAttribute('data-shake', '')
    setTimeout(() => tip.remove(), 2600)
  }

  /** The mic button next to a note box: click to start, click again to stop. Absent where the browser can't. */
  function micButton(ta) {
    if (!Speech) return null
    return ib('mic', T.talk, (e) => {
      e.stopPropagation()
      if (voice && voice.ta === ta) return releaseTalk()
      releaseTalk()
      startVoice(ta)
    }, '.mic')
  }

  /** A card with a textarea: Enter submits, Shift+Enter breaks the line, Esc closes. */
  function textBox(placeholder, onSubmit, onEscape) {
    const ta = h('textarea', { placeholder })
    ta.submit = onSubmit
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (isAlt(e)) {
        if (!e.repeat && !e.metaKey && !e.ctrlKey && !e.shiftKey) holdToTalk(ta)
        return
      }
      // ⌥ + a key types a character (@, [, …): that's not a hold.
      if (voice && !voice.rec) releaseTalk()
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault()
        onSubmit(ta.value.trim())
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        if (voice && voice.ta === ta) voice.rec?.abort()
        onEscape()
      }
    })
    return ta
  }

  function writeNote(at, x, y) {
    closePanel()
    const close = () => {
      form.remove()
      if (writing && writing.form === form) {
        writing = null
        sendCursor()
      }
    }
    const save = async (text) => {
      if (!text) return close()
      try {
        const n = await api('/notes', { method: 'POST', body: { ...at, text, author: me ? me.name : null } })
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
      h('div.row', {}, micButton(ta), h('button', { text: T.cancel, onclick: close }), h('button.ok', { text: T.save, onclick: () => save(ta.value.trim()) })),
    )
    root.append(form)
    writing = { form, at: { sel: at.selector, fx: at.fx, fy: at.fy, x: x / innerWidth, y: y + scrollY } }
    sendCursor()
    form.style.left = `${Math.max(8, Math.min(x, innerWidth - form.offsetWidth - 8))}px`
    form.style.top = `${Math.max(8, Math.min(y + 18, innerHeight - form.offsetHeight - 8))}px`
    ta.focus()
    if (touch()) aboveKeyboard(form)
    // ⌥ + click, and ⌥ still down: keep holding it and talk.
    if (held) holdToTalk(ta)
  }

  /** The on-screen keyboard takes the bottom of the screen: keep the card in what is left of it. */
  function aboveKeyboard(card) {
    const vv = window.visualViewport
    if (!vv) return
    const top = parseFloat(card.style.top)
    const fit = () => {
      if (!card.isConnected) return void vv.removeEventListener('resize', fit)
      card.style.top = `${Math.max(8, Math.min(top, vv.offsetTop + vv.height - card.offsetHeight - 8))}px`
    }
    vv.addEventListener('resize', fit)
    fit()
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
      await post('reply', { text, author: me ? me.name : null })
      const ta = root.querySelector('.panel textarea')
      if (ta) ta.value = ''
    }

    const del = ib(
      'trash',
      T.del,
      act(async () => {
        if (!del.dataset.sure) {
          del.dataset.sure = '1'
          del.dataset.tip = T.sure
          return
        }
        await api(`/notes/${n.id}`, { method: 'DELETE' })
        closePanel()
      }),
      '.del',
    )

    const review = stOf(n) === 'review'
    const running = ['queued', 'planning', 'working'].includes(n.status)
    if (review && access === 'host') del.dataset.tip = T.discard
    const buttons = [del]
    if (n.status === 'done' && n.files && n.files.length) buttons.push(ib('undo', T.undo, act(() => post('undo'))))
    if (!['handoff', 'done'].includes(n.status)) buttons.push(ib('terminal', T.handoff, act(() => post('handoff'))))
    if (n.status === 'done') buttons.push(ib('archive', T.archive, act(() => post('archive'))))
    if (n.status === 'failed') buttons.push(ib('retry', T.retry, act(() => post('retry')), '.ok'))
    if (review && access === 'host') buttons.push(ib('check', T.approve, act(() => post('approve')), '.ok'))

    let box = null
    if (!running) {
      const ph = n.status === 'asking' ? T.answer : T.follow
      box = textBox(ph, (text) => act(() => send(text))({ currentTarget: box }), closePanel)
      buttons.push(micButton(box))
      buttons.push(ib('send', n.status === 'asking' ? T.reply : T.send, act(() => send(box.value.trim())), '.ok'))
    }

    const who = { user: T.you, agent: T.agent, system: T.system }
    return h(
      `div.card.panel.ui.s-${stOf(n)}`,
      { 'data-id': n.id, onclick: (e) => e.stopPropagation() },
      h(
        'div.head',
        {},
        h('b', { text: n.page === page ? String(numberOf(n.id) || '•') : '•' }),
        h('span', { text: T.st[stOf(n)] }),
        h('small', { text: n.id }),
        h('button', { text: '×', title: T.close, onclick: closePanel }),
      ),
      (n.messages || []).map((m) => {
        const label = m.role === 'user' && m.author && (!me || m.author !== me.name) ? m.author : who[m.role] || m.role
        return h(`p.msg.${m.role}`, {}, h('em', { text: label }), m.text)
      }),
      review ? h('p.msg.system', { text: access === 'host' ? T.reviewHost : T.awaiting }) : running ? h('div.act', { text: activity[n.id] || n.activity || T.st[n.status] }) : null,
      n.status === 'handoff' ? h('p.hint', { text: T.take(n.id) }) : null,
      n.diff ? h('details', {}, h('summary', { text: T.changes((n.files || []).length) }), diffView(n.diff)) : null,
      shotsView(n.shots || {}),
      box,
      h('div.row', {}, buttons),
      n.costUsd ? h('div.cost', { text: T.cost(n) }) : null,
    )
  }

  addEventListener('resize', () => (place(), placeCursors()))
  addEventListener('scroll', () => requestAnimationFrame(placeCursors), { passive: true, capture: true })
  addEventListener('scroll', () => sendCursor(), { passive: true })
  addEventListener('scroll', () => requestAnimationFrame(place), { passive: true, capture: true })
  addEventListener('load', place)
  setInterval(place, 1000)
  // A modal or menu mounting or leaving (portals sit right under <body>): its pins follow at once.
  new MutationObserver(() => requestAnimationFrame(() => (place(), drawScope()))).observe(document.body, { childList: true })
  render()

  // --- single-page apps: the router changes the path without a reload, and the overlay has to notice, or a note
  // made after navigating would land on the first page, and others' pins would show as "on another page".
  function onRoute() {
    if (location.pathname === page) return
    page = location.pathname
    closePanel()
    pins.dataset.sig = ''
    render()
    placeCursors()
    sendCursor()
  }
  for (const k of ['pushState', 'replaceState']) {
    const orig = history[k]
    history[k] = function (...args) {
      const r = orig.apply(this, args)
      setTimeout(onRoute)
      return r
    }
  }
  addEventListener('popstate', onRoute)
  // Routers that keep their own reference to pushState slip past the patch: check now and then too.
  setInterval(onRoute, 500)

  // --- reloads (ours after a rebuild, or the dev server's HMR): back at the same scroll, mode and panel.
  try {
    const saved = JSON.parse(sessionStorage.getItem('pw-state') || 'null')
    sessionStorage.removeItem('pw-state')
    const nav = performance.getEntriesByType('navigation')[0]
    if (saved && saved.path === location.pathname + location.search && (!nav || nav.type === 'reload')) {
      const back = () => scrollTo(0, saved.y)
      document.readyState === 'complete' ? back() : addEventListener('load', back)
      setTimeout(back, 300)
      for (const id of saved.justDone || []) justDone.add(id)
      if (saved.on) setTimeout(() => setOn(true), 50)
      if (saved.panel) setTimeout(() => openPanel(saved.panel), 300)
    }
  } catch {}
  addEventListener('pagehide', () => {
    try {
      sessionStorage.setItem('pw-state', JSON.stringify({ path: location.pathname + location.search, y: scrollY, on, panel: panelId, justDone: [...justDone] }))
    } catch {}
  })
  let pending = false
  function reload() {
    const busy = root.querySelector('.form') || [...root.querySelectorAll('textarea')].some((t) => t.value.trim())
    if (busy) return void (pending = true)
    location.reload()
  }
  setInterval(() => pending && reload(), 1000)

  // --- hot updates that didn't land. The dev server sent new code (webpack, Rspack, Rsbuild: a .hot-update.js;
  // Vite: a module with ?t=) but React didn't redraw with it: typically a remote in a shell whose React started
  // before any refresh hook existed. Then the round button offers the reload instead of leaving the page stale.
  const HOT = /\.hot-update\.[cm]?js(\?|$)|[?&]t=\d{10,}/
  let lastCommit = 0
  /** React's DevTools hook, with its commits counted. None: not React, its own HMR (or a reload) takes care. */
  function reactHook() {
    const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__
    if (!hook || hook.__pwCommits) return hook
    const orig = hook.onCommitFiberRoot
    hook.onCommitFiberRoot = function (...args) {
      lastCommit = performance.now()
      return typeof orig === 'function' ? orig.apply(this, args) : undefined
    }
    hook.__pwCommits = true
    return hook
  }
  reactHook()
  let staleTimer = null
  function hotUpdate(at) {
    const hook = reactHook()
    // No hook, or only the one pinwright puts in a guest's shell and no React in it: not a React page.
    if (!hook || (hook.__pw && !hook.renderers?.size)) return
    clearTimeout(staleTimer)
    // React Refresh redraws within a frame or two; give it time, then look.
    staleTimer = setTimeout(() => {
      // A commit after the update is the redraw. (renderers can stay empty even when it works: React Refresh's
      // own fallback hook doesn't record them.)
      const redrawn = lastCommit > at
      if (redrawn) return
      // No renderer on record and no DevTools extension: React Refresh's own stand-in hook, which a second app
      // (a remote) can't reach React through. The extension's hook records it: suggest installing it.
      const noDevtools = !hook.__pw && !(hook.renderers?.size) && !hook.rendererInterfaces
      const tip = noDevtools ? T.staleDevtools : T.stale
      stale.dataset.tip = tip
      stale.setAttribute('aria-label', tip)
      stale.hidden = false
    }, 2000)
  }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (HOT.test(e.name) && !e.name.includes('/__pw/')) hotUpdate(e.startTime)
    }).observe({ type: 'resource' })
  } catch {}
})()
