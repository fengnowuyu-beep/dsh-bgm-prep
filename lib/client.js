/**
 * dsh-bgm-prep — 浏览器半边：备团工作台。
 *
 * 一个完整的工作流页面：新建表 → 编场景 → 检索 → 试听 → 定选 → 预览歌单 → 建单 / 导出。
 * 数据全部走 Host 路由 /bgm-prep/api，音频走 /bgm-prep/api/audio?id= 的代理流。
 * 设计令牌来自设计库（深色影院风）：底 #0F0F23、卡片 #1B1B30、CTA 绿 #22C55E。
 */
window.__ModuleLoader__.load({
  id: 'dsh-bgm-prep',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef, useMemo, useCallback } = React

    const NS = 'bgm-prep'
    const PAGE_ID = 'bgm-prep.workbench'
    const API = '/bgm-prep/api'

    const zh = {
      panel: '配乐工作台',
      title: '配乐工作台',
      back: '返回对话',
      empty: '还没有打开的曲目表',
      emptyHint: '新建一份，或从最近记录里打开。',
      recent: '最近打开',
      open: '打开',
      newSheet: '新建曲目表',
      newSheetHint: '填模组名和它所在的文件夹，会在 <目录>/bgm/ 下建表。',
      module: '模组名',
      dir: '模组目录',
      session: '第几回',
      scope: '范围（进文件名）',
      create: '创建',
      cancel: '取消',
      picked: '已选',
      need: '需配乐',
      total: '段',
      fetchAll: '检索全部',
      fetching: '检索中…',
      fetchOne: '找候选',
      export: '导出文档',
      commit: '建歌单',
      previewTitle: '将要写入的歌单',
      previewHint: '确认后会在你的网易云账号里新建（或复用）这张歌单。删不掉，只能你在 App 里删。',
      confirmCreate: '确认写入',
      audition: '试听',
      stop: '停止',
      choose: '选它',
      chosen: '当前选用',
      noCandidate: '这一段还没有候选曲',
      noBgmLater: '这一段不配乐',
      markNoBgm: '标为不配乐',
      markBgmLater: '改回配乐',
      trigger: '触发',
      directives: '全局要求',
      edit: '编辑',
      save: '保存',
      del: '删除本段',
      addCue: '加一段',
      sceneName: '场景名',
      triggerText: '触发/上下文',
      playing: '正在播放',
      unreachable: '连不上工作台后端',
      notPlayable: '这首放不了',
      exported: '已导出三份文件',
      committed: '已写入歌单',
      commitFailed: '建歌单失败',
      openInApp: '在 App 打开',
      refresh: '刷新',
      settings: '播放设置',
      settingsHint: '填一次网易云网页版的 MUSIC_U，会员曲才能在网页里试听。F12 → Application → Cookies → music.163.com → MUSIC_U。',
      cookie: 'MUSIC_U',
      saveSettings: '保存',
      cookieSaved: '已保存播放凭据',
      noCookie: '未设置播放凭据',
      hasCookie: '已设置播放凭据',
      noPlaylist: '尚未建过歌单',
      playlistId: '歌单 ID',
      recentFiles: '最近'
    }

    const en = {
      panel: 'BGM workbench', title: 'BGM workbench', back: 'Back to chat',
      empty: 'No cue sheet open', emptyHint: 'Create one, or open a recent sheet.',
      recent: 'Recent', open: 'Open', newSheet: 'New cue sheet',
      newSheetHint: 'Give the module name and its folder; the sheet goes to <dir>/bgm/.',
      module: 'Module', dir: 'Folder', session: 'Session', scope: 'Scope', create: 'Create', cancel: 'Cancel',
      picked: 'picked', need: 'need BGM', total: 'cues', fetchAll: 'Fetch all', fetching: 'Fetching…',
      fetchOne: 'Fetch', export: 'Export', commit: 'Create playlist',
      previewTitle: 'Playlist to write', previewHint: 'This writes a playlist into your NetEase account. It cannot be deleted from here.',
      confirmCreate: 'Write it', audition: 'Preview', stop: 'Stop', choose: 'Pick', chosen: 'Selected',
      noCandidate: 'No candidates for this cue', noBgmLater: 'No BGM', markNoBgm: 'Mark as no BGM',
      markBgmLater: 'Give it BGM', trigger: 'Trigger', directives: 'Global notes', edit: 'Edit', save: 'Save',
      del: 'Delete cue', addCue: 'Add cue', sceneName: 'Scene', triggerText: 'Trigger',
      playing: 'Now playing', unreachable: 'Host route unreachable', notPlayable: 'Not playable',
      exported: 'Exported three files', committed: 'Added to playlist', commitFailed: 'Could not create the playlist',
      openInApp: 'Open in app', refresh: 'Refresh', settings: 'Playback', settingsHint: 'Paste MUSIC_U once so member tracks play here.',
      cookie: 'MUSIC_U', saveSettings: 'Save', cookieSaved: 'Saved', noCookie: 'No playback credential',
      hasCookie: 'Playback credential set', noPlaylist: 'No playlist yet', playlistId: 'Playlist id', recentFiles: 'Recent'
    }

    const CSS = `
      .bgm-root{--bg:#0F0F23;--card:#1B1B30;--card2:#232338;--line:rgba(129,140,248,.16);--line2:rgba(129,140,248,.3);
        --fg:#F8FAFC;--muted:#94A3B8;--accent:#22C55E;--indigo:#6366F1;--danger:#EF4444;--r:16px;
        /* 普通页面容器：撑满宿主给的主内容区，跟着它一起滚动。
           不要用 absolute —— 会跳出主区，盖住侧边栏和标题栏，看起来像遮罩。 */
        position:relative;
        height:100%;
        display:flex;flex-direction:column;color:var(--fg);
        background:radial-gradient(1100px 520px at 12% -10%,rgba(99,102,241,.16),transparent 62%),
                   radial-gradient(900px 480px at 88% 110%,rgba(34,197,94,.08),transparent 60%),var(--bg);
        font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;
        overflow:hidden}
      .bgm-head{display:flex;align-items:center;gap:12px;padding:14px 22px;border-bottom:1px solid var(--line);backdrop-filter:blur(14px)}
      .bgm-title{font-size:16px;font-weight:650}
      .bgm-sub{font-size:11.5px;color:var(--muted);margin-top:2px}
      .bgm-pill{font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 9px;white-space:nowrap}
      .bgm-pill b{color:var(--fg);font-weight:600}
      .bgm-pill.warn{border-color:rgba(239,68,68,.4);color:#FCA5A5}
      .bgm-grow{flex:1}
      .bgm-btn{appearance:none;border:1px solid var(--line2);background:rgba(255,255,255,.03);color:var(--fg);border-radius:10px;
        padding:7px 12px;font-size:12.5px;cursor:pointer;font-family:inherit;transition:background .16s,border-color .16s,transform .1s}
      .bgm-btn:hover{background:rgba(255,255,255,.07);border-color:rgba(129,140,248,.45)}
      .bgm-btn:active{transform:scale(.97)}
      .bgm-btn:focus-visible{outline:2px solid #fff;outline-offset:2px}
      .bgm-btn[disabled]{opacity:.45;cursor:default}
      .bgm-btn.primary{background:var(--accent);border-color:transparent;color:#06230F;font-weight:650}
      .bgm-btn.primary:hover{background:#2ee06a}
      .bgm-btn.ghost{border-color:transparent;background:transparent;color:var(--muted)}
      .bgm-btn.ghost:hover{color:var(--fg);background:rgba(255,255,255,.05)}
      .bgm-btn.danger{color:#FCA5A5;border-color:rgba(239,68,68,.35)}
      .bgm-body{flex:1;display:grid;grid-template-columns:330px 1fr;min-height:0}
      .bgm-rail{border-right:1px solid var(--line);overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:2px}
      .bgm-rail::-webkit-scrollbar,.bgm-detail::-webkit-scrollbar{width:8px}
      .bgm-rail::-webkit-scrollbar-thumb,.bgm-detail::-webkit-scrollbar-thumb{background:rgba(148,163,184,.25);border-radius:8px}
      .bgm-rail-foot{margin-top:auto;padding-top:10px;position:sticky;bottom:0;background:linear-gradient(180deg,transparent,var(--bg) 40%)}
      .bgm-item{display:grid;grid-template-columns:28px 1fr auto;gap:10px;align-items:center;padding:9px 10px;border-radius:12px;
        cursor:pointer;border:1px solid transparent;transition:background .14s,border-color .14s}
      .bgm-item:hover{background:rgba(255,255,255,.04)}
      .bgm-item.active{background:var(--card);border-color:var(--line2)}
      .bgm-no{font-variant-numeric:tabular-nums;font-size:11.5px;color:var(--muted);text-align:right}
      .bgm-scene{font-size:13.5px;line-height:1.35}
      .bgm-scene.dim{color:var(--muted)}
      .bgm-meta{font-size:11px;color:var(--muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:210px}
      .bgm-dot{width:7px;height:7px;border-radius:50%}
      .bgm-dot.picked{background:var(--accent);box-shadow:0 0 0 3px rgba(34,197,94,.18)}
      .bgm-dot.todo{background:#64748B}
      .bgm-dot.bad{background:var(--danger)}
      .bgm-dot.off{background:transparent;border:1px solid #475569}
      .bgm-detail{overflow-y:auto;padding:22px 26px 20px}
      .bgm-h1{font-size:21px;font-weight:680}
      .bgm-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}
      .bgm-input{background:#12122A;border:1px solid var(--line2);color:var(--fg);border-radius:9px;padding:6px 10px;font-size:13px;font-family:inherit;min-width:200px}
      .bgm-input:focus{outline:2px solid rgba(99,102,241,.55);outline-offset:1px}
      .bgm-trigger{color:var(--muted);font-size:13px;line-height:1.6;flex:1}
      .bgm-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
      .bgm-tag{font-size:11px;padding:3px 9px;border-radius:999px;background:rgba(99,102,241,.12);border:1px solid rgba(99,102,241,.26);color:#C7D2FE}
      .bgm-tag.green{background:rgba(34,197,94,.14);border-color:rgba(34,197,94,.3);color:#86EFAC}
      .bgm-section{margin-top:20px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7C86A8;display:flex;align-items:center;gap:10px}
      .bgm-list{margin-top:10px;display:flex;flex-direction:column;gap:8px}
      .bgm-cand{display:grid;grid-template-columns:40px 1fr auto;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);
        border-radius:var(--r);padding:11px 13px;transition:border-color .16s,transform .12s}
      .bgm-cand:hover{border-color:var(--line2);transform:translateY(-1px)}
      .bgm-cand.picked{border-color:rgba(34,197,94,.55);background:linear-gradient(180deg,rgba(34,197,94,.08),rgba(34,197,94,.02))}
      .bgm-play{width:36px;height:36px;border-radius:50%;border:1px solid var(--line2);background:rgba(255,255,255,.04);color:var(--fg);
        cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
      .bgm-play:hover{background:rgba(34,197,94,.16);border-color:rgba(34,197,94,.5)}
      .bgm-play.on{background:var(--accent);border-color:transparent;color:#06230F}
      .bgm-c-name{font-size:13.5px;line-height:1.3}
      .bgm-c-sub{font-size:11.5px;color:var(--muted);margin-top:3px}
      .bgm-c-auto{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:5px;font-size:11.5px}
      .bgm-ai{background:rgba(99,102,241,.18);border:1px solid rgba(99,102,241,.35);color:#C7D2FE;border-radius:5px;padding:1px 6px;font-size:10.5px}
      .bgm-ai-mood{color:#CBD5E1}
      .bgm-ai-dim{color:#64748B}
      .bgm-ai-vocal{color:#FCA5A5;font-weight:600}
      .bgm-c-hint{font-size:11px;color:#7F8AA6;margin-top:4px}
      .bgm-c-why{font-size:11.5px;color:#A7F3D0;margin-top:5px}
      .bgm-actions{display:flex;gap:6px;align-items:center}
      .bgm-empty{border:1px dashed var(--line2);border-radius:var(--r);padding:22px;color:var(--muted);font-size:13px;text-align:center}
      .bgm-player{display:flex;align-items:center;gap:14px;padding:10px 22px;border-top:1px solid var(--line);
        background:linear-gradient(180deg,rgba(27,27,48,.55),rgba(15,15,35,.92));backdrop-filter:blur(16px)}
      .bgm-seek{flex:1;display:flex;align-items:center;gap:10px}
      .bgm-bar{position:relative;flex:1;height:4px;border-radius:4px;background:rgba(148,163,184,.22);cursor:pointer}
      .bgm-bar-fill{position:absolute;inset:0 auto 0 0;background:linear-gradient(90deg,var(--accent),#4ADE80);border-radius:4px}
      .bgm-time{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}
      .bgm-now{min-width:190px}
      .bgm-now-t{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}
      .bgm-now-s{font-size:11px;color:var(--muted);margin-top:2px}
      .bgm-toast{position:absolute;left:50%;bottom:78px;transform:translateX(-50%);background:#111827;border:1px solid var(--line2);
        color:var(--fg);font-size:12.5px;padding:9px 15px;border-radius:999px;box-shadow:0 12px 30px rgba(0,0,0,.45);max-width:70%;text-align:center}
      .bgm-mask{position:absolute;inset:0;background:rgba(6,8,20,.66);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;z-index:20}
      .bgm-dialog{width:min(520px,86vw);background:var(--card);border:1px solid var(--line2);border-radius:18px;padding:22px;
        box-shadow:0 30px 80px rgba(0,0,0,.6)}
      .bgm-dialog h3{margin:0 0 6px;font-size:16px}
      .bgm-hint{font-size:12px;color:var(--muted);line-height:1.6;margin:0 0 14px}
      .bgm-field{display:flex;flex-direction:column;gap:5px;margin-bottom:10px}
      .bgm-field label{font-size:11.5px;color:var(--muted)}
      .bgm-qr{display:flex;flex-direction:column;align-items:center;gap:10px;margin:6px 0 4px}
      .bgm-qr img{background:#fff;border-radius:12px;padding:8px}
      .bgm-field input{background:#12122A;border:1px solid var(--line2);color:var(--fg);border-radius:9px;padding:8px 10px;font-size:13px;font-family:inherit}
      .bgm-dialog-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
      .bgm-kv{font-size:12.5px;color:var(--muted);line-height:1.9}
      .bgm-kv b{color:var(--fg)}
      @media (max-width:980px){.bgm-body{grid-template-columns:1fr;grid-template-rows:minmax(130px,32%) 1fr}
        .bgm-rail{border-right:none;border-bottom:1px solid var(--line)}}
    `

    function installStyles() {
      if (document.getElementById('bgm-prep-style') !== null) return
      const el = document.createElement('style')
      el.id = 'bgm-prep-style'
      el.textContent = CSS
      document.head.appendChild(el)
    }

    class ApiError extends Error {
      constructor(code, message) { super(message); this.name = 'ApiError'; this.code = code }
    }

    async function callApi(method, payload) {
      let response
      try {
        response = await fetch(`${API}/${method}`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload ?? {})
        })
      } catch {
        throw new ApiError('unreachable', 'host route unreachable')
      }
      let data
      try { data = await response.json() } catch { throw new ApiError('bad-response', 'host answered a non-JSON body') }
      if (data === null || typeof data !== 'object' || data.ok !== true) {
        const info = data !== null && typeof data === 'object' ? data.error : null
        throw new ApiError(String(info?.code ?? 'failed'), String(info?.message ?? 'request failed'))
      }
      return data.data
    }

    const audioUrl = (id) => `${API}/audio?id=${encodeURIComponent(String(id))}`
    const clock = (s) => (!Number.isFinite(s) || s <= 0 ? '--:--' : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`)
    const VALENCE = { bright: '明', neutral: '中', dark: '暗' }
    const ENERGY = { static: '静态', building: '渐强', driving: '推进', burst: '爆发' }

    function tagChips(tags) {
      if (!tags) return []
      const out = []
      if (tags.valence) out.push(VALENCE[tags.valence] ?? tags.valence)
      if (tags.energy) out.push(ENERGY[tags.energy] ?? tags.energy)
      if (Array.isArray(tags.texture) && tags.texture.length > 0) out.push(tags.texture.join('/'))
      if (tags.vocal) out.push(tags.vocal === 'none' ? '无人声' : tags.vocal === 'lyrics' ? '有词' : '无词人声')
      if (Number.isFinite(tags.tension)) out.push(`张力 ${tags.tension}`)
      return out
    }

    function PlayGlyph({ playing }) {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, 'aria-hidden': true, focusable: 'false' },
        playing
          ? h('rect', { x: 3, y: 2.5, width: 3.6, height: 11, rx: 1, fill: 'currentColor' })
          : h('path', { d: 'M4 2.6l9.2 5.4L4 13.4z', fill: 'currentColor' }))
    }

    function OpenInAppGlyph() {
      return h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M6.2 3.4h6.4v6.4', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('path', { d: 'M12.6 3.4L4.2 11.8', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))
    }

    /**
     * 自动打标的结果：一句情绪判断 + 一个「有没有人声」的角标。
     * 置信度低（top1 与 top2 差距 < 0.1）时显式标出来，避免把并列当成结论。
     */
    function AutoTags({ auto }) {
      if (!auto) return null
      if (auto.error) {
        return h('div', { className: 'bgm-c-auto' },
          h('span', { className: 'bgm-ai' }, '自动'),
          h('span', { className: 'bgm-ai-dim' }, ' 拿不到音频，未打标'))
      }
      const top = Array.isArray(auto.top) ? auto.top : []
      if (top.length === 0) return null
      const [first, second] = top
      const unsure = Number.isFinite(auto.margin) && auto.margin < 0.1
      const vocal = Number(auto.vocal ?? 0)
      return h('div', { className: 'bgm-c-auto' },
        h('span', { className: 'bgm-ai' }, '自动'),
        h('span', { className: 'bgm-ai-mood' },
          unsure && second
            ? `${first[0]} ${first[1]} / ${second[0]} ${second[1]}`
            : `${first[0]} ${first[1]}`),
        unsure ? h('span', { className: 'bgm-ai-dim' }, ' 不确定') : null,
        vocal >= 0.6
          ? h('span', { className: 'bgm-ai-vocal' }, ` 人声 ${vocal.toFixed(2)}`)
          : h('span', { className: 'bgm-ai-dim' }, ` 人声 ${vocal.toFixed(2)}`))
    }

    function BackGlyph() {
      return h('svg', { viewBox: '0 0 16 16', width: 14, height: 14, fill: 'none', 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M9.6 3.4L5 8l4.6 4.6', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    /** 最近一次"对话页"的 hash。工作台打开时它会变，所以得在路由变化里记住。 */
    const HASH_KEY = 'bgm-prep:last-conversation-hash'

    function rememberConversationHash() {
      try {
        const hash = window.location.hash
        if (typeof hash === 'string' && hash.includes('/s/')) window.sessionStorage.setItem(HASH_KEY, hash)
      } catch { /* 隐私模式忽略 */ }
    }

    function goBack() {
      let saved = ''
      try { saved = window.sessionStorage.getItem(HASH_KEY) ?? '' } catch { /* ignore */ }
      if (saved !== '' && window.location.hash !== saved) {
        window.location.hash = saved
        return
      }
      // main 面板常常不改路由，history 也可能没东西可退：
      // 320ms 后如果还停在原地，就硬回应用根地址（整页重载，面板一定关掉）。
      const before = window.location.href
      try { window.history.back() } catch { /* ignore */ }
      window.setTimeout(() => {
        if (window.location.href !== before) return
        try { window.location.assign(`${window.location.origin}/`) } catch { /* ignore */ }
      }, 320)
    }

    function Workbench({ t }) {
      const tr = typeof t === 'function' ? t : (key) => (zh[key] ?? key)
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [selected, setSelected] = useState('')
      const [playing, setPlaying] = useState({ songId: 0, title: '', artist: '' })
      const [isPlaying, setIsPlaying] = useState(false)
      const [progress, setProgress] = useState({ current: 0, total: 0 })
      const [busy, setBusy] = useState('')
      const [toast, setToast] = useState('')
      const [dialog, setDialog] = useState('')          // '' | 'new' | 'settings' | 'preview'
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState({ scene: '', trigger: '' })
      const [newSheet, setNewSheet] = useState({ module: '', dir: '', session: '1', scope: 'main' })
      const [preview, setPreview] = useState(null)
      const [cookieInput, setCookieInput] = useState('')
      const audioRef = useRef(null)
      const toastTimer = useRef(0)

      const notify = useCallback((message) => {
        setToast(message)
        if (toastTimer.current) clearTimeout(toastTimer.current)
        toastTimer.current = setTimeout(() => setToast(''), 4200)
      }, [])

      const load = useCallback(async () => {
        try {
          const snapshot = await callApi('snapshot', {})
          setData(snapshot)
          setError('')
          if (snapshot?.cues?.length) {
            setSelected((cur) => (cur && snapshot.cues.some((c) => c.id === cur))
              ? cur
              : (snapshot.cues.find((c) => c.need_bgm) ?? snapshot.cues[0]).id)
          }
        } catch (err) {
          setError(err.code === 'unreachable' ? tr('unreachable') : err.message)
        }
      }, [tr])

      useEffect(() => { void load() }, [])
      useEffect(() => {
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          if (dialog !== '') { stopLoginPoll(); setLoginPhase(''); setDialog('') }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [dialog, stopLoginPoll])
      useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); stopLoginPoll() }, [stopLoginPoll])

      const cue = useMemo(() => {
        if (!data?.cues?.length) return null
        return data.cues.find((c) => c.id === selected) ?? data.cues[0]
      }, [data, selected])

      useEffect(() => {
        setEditing(false)
        setDraft({ scene: cue?.scene ?? '', trigger: cue?.trigger ?? '' })
      }, [cue?.id])

      const play = useCallback(async (candidate) => {
        const audio = audioRef.current
        if (!audio) return
        if (playing.songId === candidate.song_id && isPlaying) { audio.pause(); return }
        audio.src = audioUrl(candidate.song_id)
        setPlaying({ songId: candidate.song_id, title: candidate.title, artist: candidate.artist })
        try { await audio.play() } catch { /* onError 会说明原因 */ }
      }, [playing.songId, isPlaying])

      const act = useCallback(async (label, fn) => {
        setBusy(label)
        try { await fn() } catch (err) { notify(err.message) } finally { setBusy('') }
      }, [notify])

      const pick = useCallback((candidate) => act('pick', async () => {
        const next = await callApi('pick', {
          file: data.active, cueId: cue.id, songId: candidate.song_id,
          why: `${candidate.album || '器乐'}｜${candidate.title}`.slice(0, 30),
          alts: (cue.candidates ?? []).filter((c) => c.song_id !== candidate.song_id).slice(0, 2)
            .map((c) => ({ song_id: c.song_id, why: c.title.slice(0, 20) }))
        })
        setData(next)
        notify(`${tr('chosen')}: ${candidate.title}`)
      }), [act, cue, data, notify, tr])

      const fetchCue = useCallback((ids, force) => act('fetch', async () => {
        let filled = 0
        for (let round = 0; round < 4; round += 1) {
          const r = await callApi('fetch', { file: data.active, cueIds: ids, force })
          filled += r.filled ?? 0
          if ((r.filled ?? 0) === 0) break
        }
        await load()
        notify(`${tr('fetchAll')}: ${filled}`)
      }), [act, data, load, notify, tr])

      const saveCue = useCallback(() => act('save', async () => {
        const next = await callApi('patch-cue', {
          file: data.active, cueId: cue.id, scene: draft.scene, trigger: draft.trigger
        })
        setData(next)
        setEditing(false)
      }), [act, cue, data, draft])

      const deleteCue = useCallback(() => act('del', async () => {
        const next = await callApi('delete-cue', { file: data.active, cueId: cue.id })
        setData(next)
        setSelected('')
        notify(tr('del'))
      }), [act, cue, data, notify, tr])

      const addCue = useCallback(() => act('add', async () => {
        const next = await callApi('add-cue', { file: data.active, scene: '新场景' })
        setData(next)
      }), [act, data])

      const toggleNeed = useCallback(() => act('need', async () => {
        const next = await callApi('need-bgm', { file: data.active, cueId: cue.id, value: !cue.need_bgm })
        setData(next)
      }), [act, cue, data])

      const doTag = useCallback((cueIds) => act('tag', async () => {
        const result = await callApi('tag', { file: data.active, cueIds, perCue: 5 })
        setData(result.sheet)
        const extra = result.failed > 0 ? `，${result.failed} 首拿不到音频` : ''
        notify(`已打标 ${result.tagged} 首${extra}`)
      }), [act, data, notify])

      const doExport = useCallback(() => act('export', async () => {
        await callApi('export', { file: data.active })
        notify(tr('exported'))
        await load()
      }), [act, data, load, notify, tr])

      const openPreview = useCallback(() => act('preview', async () => {
        const r = await callApi('playlist-preview', { file: data.active })
        setPreview(r)
        setDialog('preview')
      }), [act, data])

      const doCommit = useCallback(() => act('commit', async () => {
        const r = await callApi('commit', { file: data.active })
        setDialog('')
        notify(`${tr('committed')}: ${r.playlist} (+${r.added})`)
        await load()
      }), [act, data, load, notify, tr])

      const createSheet = useCallback(() => act('create', async () => {
        const next = await callApi('create-sheet', newSheet)
        setData(next)
        setDialog('')
        setSelected('')
        notify(tr('newSheet'))
      }), [act, newSheet, notify, tr])

      const [loginPhase, setLoginPhase] = useState('')   // '' | 'loading' | 'waiting' | 'scanned' | 'expired'
      const [qr, setQr] = useState(null)
      const loginTimer = useRef(0)
      const stopLoginPoll = useCallback(() => {
        if (loginTimer.current) { clearTimeout(loginTimer.current); loginTimer.current = 0 }
      }, [])

      /** 面板内扫码登录：出码 → 轮询 → 成功后 Host 直接落库（存的是完整 cookie 串）。 */
      const startNeteaseLogin = useCallback(() => act('login', async () => {
        stopLoginPoll()
        setLoginPhase('loading')
        const started = await callApi('login-start', {})
        setQr({ svg: started.svg, key: started.key })
        setLoginPhase('waiting')
        const startedAt = Date.now()
        const tick = async () => {
          if (Date.now() - startedAt > 180000) { setLoginPhase('expired'); return }
          let state = null
          try { state = await callApi('login-poll', { key: started.key }) } catch { /* 抖一下就继续等 */ }
          if (state?.status === 'ok') {
            setQr(null)
            setLoginPhase('')
            setDialog('')
            notify(`登录成功：${state.nickname || '已登录'}（${state.fields} 个字段）`)
            await load()
            return
          }
          if (state?.status === 'scanned') setLoginPhase('scanned')
          if (state?.status === 'expired') { setLoginPhase('expired'); return }
          loginTimer.current = window.setTimeout(tick, 2000)
        }
        loginTimer.current = window.setTimeout(tick, 2000)
      }), [act, load, notify, stopLoginPoll])

      const saveCookie = useCallback(() => act('settings', async () => {
        const result = await callApi('settings', { set: true, musicUCookie: cookieInput })
        setDialog('')
        setCookieInput('')
        notify(result.valid
          ? `已保存并验证：${result.nickname || '已登录'}`
          : `已保存，但服务端说没登录（${result.reason || '会话失效'}）`)
        await load()
      }), [act, cookieInput, load, notify, tr])

      if (error) {
        return h('div', { className: 'bgm-root' },
          h('div', { className: 'bgm-head' },
            h('div', { className: 'bgm-title' }, tr('title'))),
          h('div', { className: 'bgm-detail' }, h('div', { className: 'bgm-empty' }, error)))
      }
      if (data === null) {
        return h('div', { className: 'bgm-root' },
          h('div', { className: 'bgm-head' }, h('div', { className: 'bgm-title' }, tr('title'))),
          h('div', { className: 'bgm-detail' }, h('div', { className: 'bgm-empty' }, '…')))
      }

      const cues = data.cues ?? []
      const stats = data.stats ?? { total: 0, need: 0, picked: 0, insufficient: 0 }
      const hasSheet = Boolean(data.active)

      const dialogEl = dialog === '' ? null : h('div', { className: 'bgm-mask', onClick: (e) => { if (e.target === e.currentTarget) setDialog('') } },
        dialog === 'new' ? h('div', { className: 'bgm-dialog' },
          h('h3', null, tr('newSheet')),
          h('p', { className: 'bgm-hint' }, tr('newSheetHint')),
          h('div', { className: 'bgm-field' }, h('label', null, tr('module')),
            h('input', { value: newSheet.module, placeholder: '通向庭院之歌', onChange: (e) => setNewSheet({ ...newSheet, module: e.target.value }) })),
          h('div', { className: 'bgm-field' }, h('label', null, tr('dir')),
            h('input', { value: newSheet.dir, placeholder: 'F:\\Data\\听枫馆\\模组\\COC\\018通向庭院之歌', onChange: (e) => setNewSheet({ ...newSheet, dir: e.target.value }) })),
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
            h('div', { className: 'bgm-field' }, h('label', null, tr('session')),
              h('input', { value: newSheet.session, onChange: (e) => setNewSheet({ ...newSheet, session: e.target.value }) })),
            h('div', { className: 'bgm-field' }, h('label', null, tr('scope')),
              h('input', { value: newSheet.scope, onChange: (e) => setNewSheet({ ...newSheet, scope: e.target.value }) }))),
          h('div', { className: 'bgm-dialog-foot' },
            h('button', { className: 'bgm-btn ghost', onClick: () => setDialog('') }, tr('cancel')),
            h('button', { className: 'bgm-btn primary', disabled: busy !== '', onClick: createSheet }, tr('create'))))
          : dialog === 'settings' ? h('div', { className: 'bgm-dialog' },
            h('h3', null, tr('settings')),
            h('p', { className: 'bgm-hint' }, qr === null
              ? tr('settingsHint')
              : '用手机上的网易云 App 扫码。登录成功后会自动保存完整登录态（含 __csrf），会员曲才能取到能播的直链。'),
            qr === null ? null : h('div', { className: 'bgm-qr' },
              h('img', {
                src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`,
                width: 220, height: 220, alt: '网易云登录二维码'
              }),
              h('div', { className: 'bgm-kv' },
                loginPhase === 'scanned' ? '已扫描，请在手机上确认登录'
                  : loginPhase === 'expired' ? '二维码已过期，关掉重新点「登录网易云」'
                    : '等待扫码…')),
            qr === null ? h(React.Fragment, null,
              h('div', { className: 'bgm-field' }, h('label', null, tr('cookie')),
                h('input', {
                  value: cookieInput,
                  placeholder: data.hasCookie ? '已保存（想换就粘贴新的）' : 'MUSIC_U=... 或整串 k=v; k=v; …',
                  onChange: (e) => setCookieInput(e.target.value)
                })),
              h('div', { className: 'bgm-kv' }, data.hasCookie
                ? `${tr('hasCookie')}${data.cookieFields ? `（${data.cookieFields} 个字段）` : ''}`
                : tr('noCookie'))) : null,
            h('div', { className: 'bgm-dialog-foot' },
              h('button', {
                className: 'bgm-btn ghost',
                onClick: () => { stopLoginPoll(); setLoginPhase(''); setQr(null); setDialog('') }
              }, tr('cancel')),
              h('button', {
                className: 'bgm-btn', disabled: busy !== '' || loginPhase === 'waiting' || loginPhase === 'loading',
                onClick: startNeteaseLogin
              }, loginPhase === 'loading' ? '取二维码…' : loginPhase === 'waiting' || loginPhase === 'scanned' ? '等待扫码…' : '登录网易云'),
              h('button', {
                className: 'bgm-btn danger', disabled: busy !== '' || !data.hasCookie,
                onClick: () => act('clear-cookie', async () => {
                  await callApi('cookie-clear', {})
                  notify('已清除播放凭据')
                  await load()
                })
              }, '清除'),
              h('button', { className: 'bgm-btn primary', disabled: busy !== '', onClick: saveCookie }, tr('saveSettings'))))
            : h('div', { className: 'bgm-dialog' },
              h('h3', null, tr('previewTitle')),
              h('p', { className: 'bgm-hint' }, tr('previewHint')),
              h('div', { className: 'bgm-kv' },
                h('div', null, tr('previewTitle'), '：', h('b', null, preview?.playlist ?? '—')),
                h('div', null, '新增 ', h('b', null, String(preview?.added ?? 0)), ' 首 / 共 ', h('b', null, String(preview?.total ?? 0)), ' 段'),
                (preview?.missing?.length ? h('div', null, '未选段：', preview.missing.join('、')) : null)),
              h('div', { className: 'bgm-dialog-foot' },
                h('button', { className: 'bgm-btn ghost', onClick: () => setDialog('') }, tr('cancel')),
                h('button', { className: 'bgm-btn primary', disabled: busy !== '', onClick: doCommit }, tr('confirmCreate')))))

      return h('div', { className: 'bgm-root' },
        h('div', { className: 'bgm-head' },
          h('div', null,
            h('div', { className: 'bgm-title' }, data.module || tr('title')),
            h('div', { className: 'bgm-sub' },
              [data.session ? `第 ${data.session} 回` : '', data.scope ?? ''].filter(Boolean).join(' · ') || tr('emptyHint'))),
          hasSheet
            ? h('div', { style: { display: 'flex', gap: 6, marginLeft: 8 } },
              h('span', { className: 'bgm-pill' }, h('b', null, `${stats.picked}/${stats.need}`), ' ', tr('picked')),
              h('span', { className: 'bgm-pill' }, h('b', null, String(stats.total)), ' ', tr('total')),
              stats.insufficient > 0 ? h('span', { className: 'bgm-pill warn' }, '候选不足 ', h('b', null, String(stats.insufficient))) : null,
              data.playlistId ? h('span', { className: 'bgm-pill' }, tr('playlistId'), ' ', h('b', null, String(data.playlistId).slice(0, 8))) : null)
            : null,
          h('div', { className: 'bgm-grow' }),
          h('button', { className: 'bgm-btn ghost', onClick: () => setDialog('settings'), title: tr('settings') },
            data.hasCookie ? '🔊' : '🔈', ' ', tr('settings')),
          hasSheet ? h('button', { className: 'bgm-btn', disabled: busy !== '', onClick: () => doTag() },
            busy === 'tag' ? '打标中…' : '自动打标') : null,
          hasSheet ? h('button', { className: 'bgm-btn', disabled: busy !== '', onClick: () => fetchCue(undefined, false) },
            busy === 'fetch' ? tr('fetching') : tr('fetchAll')) : null,
          h('button', { className: 'bgm-btn', disabled: busy !== '' || !hasSheet, onClick: doExport }, tr('export')),
          h('button', {
            className: 'bgm-btn primary', disabled: busy !== '' || !hasSheet || stats.picked === 0, onClick: openPreview
          }, tr('commit'))),

        h('div', { className: 'bgm-body' },
          h('div', { className: 'bgm-rail' },
            hasSheet
              ? cues.map((c) => h('div', {
                key: c.id,
                className: `bgm-item${c.id === cue?.id ? ' active' : ''}`,
                role: 'button', tabIndex: 0,
                onClick: () => setSelected(c.id),
                onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') setSelected(c.id) }
              },
                h('div', { className: 'bgm-no' }, String(c.no).padStart(2, '0')),
                h('div', null,
                  h('div', { className: `bgm-scene${c.need_bgm ? '' : ' dim'}` }, c.scene),
                  h('div', { className: 'bgm-meta' },
                    c.status === 'picked'
                      ? ((c.candidates.find((x) => x.song_id === c.picks?.primary?.song_id) ?? {}).title ?? tr('picked'))
                      : c.need_bgm ? tr('need') : tr('noBgmLater'))),
                h('span', { className: `bgm-dot ${c.status === 'picked' ? 'picked' : !c.need_bgm ? 'off' : c.status === 'insufficient' ? 'bad' : 'todo'}` })))
              : h('div', { className: 'bgm-empty', style: { margin: 10 } },
                h('div', null, tr('empty')),
                h('div', { style: { marginTop: 8 } },
                  h('button', { className: 'bgm-btn primary', onClick: () => setDialog('new') }, tr('newSheet'))),
                (data.recent ?? []).length > 0
                  ? h('div', { style: { marginTop: 14, textAlign: 'left' } },
                    h('div', { className: 'bgm-section' }, tr('recent')),
                    (data.recent ?? []).map((r) => h('div', { key: r.file, style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 } },
                      h('span', { style: { flex: 1, fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: r.file }, r.file),
                      h('button', {
                        className: 'bgm-btn ghost',
                        onClick: () => { void callApi('open', { file: r.file }).then(setData).catch(() => {}) }
                      }, tr('open')))))
                  : null),
            hasSheet ? h('div', { className: 'bgm-rail-foot' },
              h('button', {
                className: 'bgm-btn ghost', style: { width: '100%' }, disabled: busy !== '', onClick: addCue
              }, '+ ', tr('addCue'))) : null),

          h('div', { className: 'bgm-detail' },
            cue === null
              ? h('div', { className: 'bgm-empty' },
                hasSheet ? h('div', null, tr('addCue')) : h('div', null, tr('emptyHint')))
              : h(React.Fragment, null,
                editing
                  ? h('div', null,
                    h('div', { className: 'bgm-row' },
                      h('input', { className: 'bgm-input', style: { flex: 1, fontSize: 16 }, value: draft.scene, onChange: (e) => setDraft({ ...draft, scene: e.target.value }), 'aria-label': tr('sceneName') })),
                    h('div', { className: 'bgm-row' },
                      h('input', { className: 'bgm-input', style: { flex: 1 }, value: draft.trigger, placeholder: tr('triggerText'), onChange: (e) => setDraft({ ...draft, trigger: e.target.value }), 'aria-label': tr('triggerText') })),
                    h('div', { className: 'bgm-row' },
                      h('button', { className: 'bgm-btn primary', disabled: busy !== '', onClick: saveCue }, tr('save')),
                      h('button', { className: 'bgm-btn ghost', onClick: () => { setEditing(false); setDraft({ scene: cue.scene, trigger: cue.trigger }) } }, tr('cancel')),
                      h('button', { className: 'bgm-btn danger', disabled: busy !== '', onClick: deleteCue }, tr('del'))))
                  : h('div', null,
                    h('div', { className: 'bgm-h1' }, cue.scene),
                    h('div', { className: 'bgm-row' },
                      cue.trigger ? h('div', { className: 'bgm-trigger' }, `${tr('trigger')} · ${cue.trigger}`) : h('div', { className: 'bgm-trigger' }),
                      h('button', { className: 'bgm-btn ghost', onClick: () => { setDraft({ scene: cue.scene, trigger: cue.trigger ?? '' }); setEditing(true) } }, tr('edit')))),

                h('div', { className: 'bgm-tags' },
                  tagChips(cue.tags).map((label) => h('span', { className: 'bgm-tag', key: label }, label)),
                  cue.need_bgm ? null : h('span', { className: 'bgm-tag green' }, tr('noBgmLater')),
                  Array.isArray(cue.wants) && cue.wants.length > 0
                    ? h('span', { className: 'bgm-tag', key: 'wants' }, cue.wants[0]) : null),

                (data.directives ?? []).length > 0
                  ? h('div', null,
                    h('div', { className: 'bgm-section' }, tr('directives')),
                    h('div', { className: 'bgm-tags' }, data.directives.map((d, i) => h('span', { className: 'bgm-tag', key: i }, d.text))))
                  : null,

                h('div', { className: 'bgm-section' },
                  `${(cue.candidates ?? []).length} 首候选`,
                  h('div', { className: 'bgm-grow' }),
                  h('button', {
                    className: 'bgm-btn ghost', disabled: busy !== '' || (cue.candidates ?? []).length === 0,
                    onClick: () => doTag([cue.id])
                  }, busy === 'tag' ? '打标中…' : '打标'),
                  h('button', {
                    className: 'bgm-btn ghost', disabled: busy !== '',
                    onClick: () => fetchCue([cue.id], (cue.candidates ?? []).length > 0)
                  }, busy === 'fetch' ? tr('fetching') : tr('fetchOne'))),

                h('div', { className: 'bgm-list' },
                  (cue.candidates ?? []).length === 0
                    ? h('div', { className: 'bgm-empty' }, tr('noCandidate'))
                    : cue.candidates.map((candidate) => {
                      const isPicked = cue.picks?.primary?.song_id === candidate.song_id
                      const isCurrent = playing.songId === candidate.song_id && isPlaying
                      return h('div', { className: `bgm-cand${isPicked ? ' picked' : ''}`, key: candidate.song_id },
                        h('button', {
                          className: `bgm-play${isCurrent ? ' on' : ''}`,
                          'aria-label': isCurrent ? tr('stop') : tr('audition'),
                          title: isCurrent ? tr('stop') : tr('audition'),
                          onClick: () => void play(candidate)
                        }, h(PlayGlyph, { playing: isCurrent })),
                        h('div', null,
                          h('div', { className: 'bgm-c-name' }, candidate.title),
                          h('div', { className: 'bgm-c-sub' }, [candidate.artist, candidate.album, clock(candidate.duration)].filter(Boolean).join(' · ')),
                          h(AutoTags, { auto: candidate.auto }),
                          candidate.hint ? h('div', { className: 'bgm-c-hint' }, candidate.hint) : null,
                          isPicked && cue.picks?.primary?.why ? h('div', { className: 'bgm-c-why' }, cue.picks.primary.why) : null),
                        h('div', { className: 'bgm-actions' },
                          h('a', {
                            className: 'bgm-btn ghost', href: `orpheus://song/${candidate.song_id}`,
                            title: tr('openInApp'), 'aria-label': tr('openInApp'), onClick: (e) => e.stopPropagation()
                          }, h(OpenInAppGlyph)),
                          h('button', {
                            className: `bgm-btn${isPicked ? ' ghost' : ''}`, disabled: busy !== '' || isPicked,
                            onClick: () => pick(candidate)
                          }, isPicked ? tr('chosen') : tr('choose'))))
                    })),

                h('div', { className: 'bgm-row', style: { marginTop: 18 } },
                  h('button', { className: 'bgm-btn ghost', disabled: busy !== '', onClick: toggleNeed },
                    cue.need_bgm ? tr('markNoBgm') : tr('markBgmLater')))))),

        h('div', { className: 'bgm-player' },
          h('button', {
            className: `bgm-play${isPlaying ? ' on' : ''}`,
            'aria-label': isPlaying ? tr('stop') : tr('audition'),
            disabled: playing.songId === 0,
            onClick: () => {
              const audio = audioRef.current
              if (!audio) return
              if (isPlaying) audio.pause()
              else void audio.play().catch(() => notify(tr('notPlayable')))
            }
          }, h(PlayGlyph, { playing: isPlaying })),
          h('div', { className: 'bgm-now' },
            h('div', { className: 'bgm-now-t' }, playing.title || tr('playing')),
            h('div', { className: 'bgm-now-s' }, playing.artist || '')),
          h('div', { className: 'bgm-seek' },
            h('span', { className: 'bgm-time' }, clock(progress.current)),
            h('div', {
              className: 'bgm-bar',
              onClick: (e) => {
                const audio = audioRef.current
                if (!audio) return
                if (!Number.isFinite(progress.total) || progress.total <= 0) { notify(tr('notPlayable')); return }
                const rect = e.currentTarget.getBoundingClientRect()
                const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
                try { audio.currentTime = ratio * progress.total } catch { /* not ready */ }
              }
            }, h('div', { className: 'bgm-bar-fill', style: { width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` } })),
            h('span', { className: 'bgm-time' }, clock(progress.total)))),

        h('audio', {
          ref: audioRef, preload: 'none',
          onPlay: () => setIsPlaying(true),
          onPause: () => setIsPlaying(false),
          onEnded: () => { setIsPlaying(false); setProgress({ current: 0, total: 0 }) },
          onTimeUpdate: (e) => setProgress({ current: e.currentTarget.currentTime, total: e.currentTarget.duration || 0 }),
          onLoadedMetadata: (e) => setProgress({ current: 0, total: e.currentTarget.duration || 0 }),
          onError: () => { setIsPlaying(false); notify(tr('notPlayable')) }
        }),

        dialogEl,
        toast === '' ? null : h('div', { className: 'bgm-toast', role: 'status' }, toast))
    }

    function SidebarIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', 'aria-hidden': true, focusable: 'false' },
        h('path', { d: 'M6 12.6V4.4l6-1.4v8.2', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('circle', { cx: 4.4, cy: 12.6, r: 1.7, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('circle', { cx: 10.4, cy: 11.2, r: 1.7, stroke: 'currentColor', strokeWidth: 1.3 }))
    }

    function apply(ctx) {
      installStyles()
      rememberConversationHash()
      ctx.effect(() => {
        const onChange = () => rememberConversationHash()
        window.addEventListener('hashchange', onChange)
        return () => window.removeEventListener('hashchange', onChange)
      }, 'bgm-prep: remember conversation route')
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'bgm-prep: dictionaries')
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main', key: PAGE_ID, locale: NS
      }, Workbench)), 'bgm-prep: workbench page')
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: PAGE_ID, order: 21, locale: NS, label: () => t('panel')
      }, SidebarIcon)), 'bgm-prep: sidebar entry')
    }

    return {
      inject: ['slots', 'locale'],
      apply,
      __internals: { NS, PAGE_ID, API, callApi, audioUrl, clock, tagChips, Workbench, SidebarIcon, goBack, zh, en }
    }
  }
})







