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
      .bgm-tag.warn{background:rgba(251,191,36,.12);border-color:rgba(251,191,36,.32);color:#FCD34D}
      .bgm-avoid{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px}
      .bgm-avoid-label{font-size:11px;color:#FCD34D;letter-spacing:.08em}
      .bgm-avoid-chip{display:inline-flex;align-items:center;gap:6px;padding-right:4px}
      .bgm-avoid-name{cursor:default}
      .bgm-avoid-num{width:58px;padding:2px 4px;font-size:11px;height:24px;text-align:center;border-radius:6px;
        background:rgba(255,255,255,.05);border:1px solid rgba(251,191,36,.35);color:#FDE68A}
      .bgm-avoid-x{cursor:pointer;opacity:.7;padding:0 3px;font-size:12px}
      .bgm-avoid-x:hover{opacity:1;color:#FCA5A5}
      .bgm-avoid-pick{width:auto;min-width:96px;padding:4px 6px;font-size:11px;height:26px}
      .bgm-c-avoid{font-size:11px;color:#FCD34D;margin-top:4px;opacity:.9}
      .bgm-c-vocal{font-size:11px;color:#FCA5A5;margin-top:4px;opacity:.95}
      .bgm-c-target{font-size:11px;color:#A5B4FC;margin-top:4px;opacity:.95}
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
      .bgm-cand.weak{opacity:.52;filter:saturate(.6)}
      .bgm-cand.weak:hover{opacity:.9}
      .bgm-ai-match{border-radius:5px;padding:1px 6px;font-size:10.5px;border:1px solid transparent}
      .bgm-ai-match.good{color:#86EFAC;border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.12)}
      .bgm-ai-match.fair{color:#FCD34D;border-color:rgba(251,191,36,.3);background:rgba(251,191,36,.1)}
      .bgm-ai-match.poor{color:#FCA5A5;border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.1)}
      .bgm-ai{background:rgba(99,102,241,.18);border:1px solid rgba(99,102,241,.35);color:#C7D2FE;border-radius:5px;padding:1px 6px;font-size:10.5px}
      .bgm-ai-top{color:#E2E8F0;font-weight:600}
      .bgm-ai-soft{color:#94A3B8}
      .bgm-ai-sep{color:#334155;margin:0 2px}
      .bgm-ai-vocal2{border-radius:5px;padding:1px 6px;border:1px solid transparent}
      .bgm-ai-vocal2.good{color:#86EFAC;border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.1)}
      .bgm-ai-vocal2.warn{color:#FCD34D;border-color:rgba(251,191,36,.3);background:rgba(251,191,36,.1)}
      .bgm-ai-vocal2.bad{color:#FCA5A5;border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.12)}
      .bgm-ai-mood{color:#CBD5E1}
      .bgm-ai-dim{color:#64748B}
      .bgm-ai-vocal{color:#FCA5A5;font-weight:600}
      .bgm-c-hint{font-size:11px;color:#7F8AA6;margin-top:4px}
      .bgm-c-why{font-size:11.5px;color:#A7F3D0;margin-top:5px}
      .bgm-actions{display:flex;gap:6px;align-items:center}
      .bgm-empty{border:1px dashed var(--line2);border-radius:var(--r);padding:22px;color:var(--muted);font-size:13px;text-align:center}
      .bgm-player{display:flex;align-items:center;gap:14px;padding:10px 22px;border-top:1px solid var(--line);
        background:linear-gradient(180deg,rgba(27,27,48,.55),rgba(15,15,35,.92));backdrop-filter:blur(16px);
        /* Electron 桌面版：底部可能落在窗口拖拽区，显式排除，否则鼠标事件会被窗口拖拽吞掉 */
        -webkit-app-region:no-drag}
      .bgm-seek{flex:1;display:flex;align-items:center;gap:10px;-webkit-app-region:no-drag}
      .bgm-bar{position:relative;flex:1;height:24px;display:flex;align-items:center;cursor:pointer;touch-action:none}
      .bgm-bar-track{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:4px;border-radius:4px;background:rgba(148,163,184,.22)}
      .bgm-bar-fill{position:absolute;left:0;top:50%;transform:translateY(-50%);height:4px;border-radius:4px;background:linear-gradient(90deg,var(--accent),#4ADE80)}
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
      .bgm-hist{max-height:44vh;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin:4px 0 2px}
      .bgm-hist-row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:9px 11px;border:1px solid var(--line);border-radius:12px;background:var(--card)}
      .bgm-hist-name{font-size:13px}
      .bgm-hist-sub{font-size:11px;color:var(--muted);margin-top:3px}
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

    /** 目标 chips：`黑暗 0.40` 这样带权重（显示中文，数据仍是英文标签）。 */
    function targetChips(target, labels = {}) {
      if (!Array.isArray(target)) return []
      return target.map((t) => `${labels[t.tag] ?? t.tag} ${pct(t.weight)}`)
    }

    /** 0–1 的数值统一显示成整数百分比（无小数位）。 */
    function pct(value) {
      const n = Number(value)
      if (!Number.isFinite(n)) return '—'
      return `${Math.round(n * 100)}%`
    }

    // 人声态度：none=不出现（全额）、any=可接受（半额）、wordless=歌声（不罚）
    const VOCAL_ATTITUDE = { none: ['不出现', 1], any: ['可接受', 0.5], wordless: ['歌声', 0] }

    /**
     * 打分公式（与 lib/score.js 的 vocalFactor 一致）：
     *   人声因子 = 1 − penalty × 档位 × clamp((p − threshold) / (1 − threshold), 0, 1)
     * 界面上把它写出来，避免「最多 −60%」「起罚线 0.1」两个数被混为一谈。
     */
    function vocalFormulaHint(data) {
      const penalty = Number.isFinite(Number(data?.vocalPenalty)) ? Number(data.vocalPenalty) : 0.6
      const threshold = Number.isFinite(Number(data?.vocalThreshold)) ? Number(data.vocalThreshold) : 0.1
      const penaltyPct = Math.round(penalty * 100)
      const thresholdPct = Math.round(threshold * 100)
      const restPct = Math.round((1 - threshold) * 100)
      return `人声因子 = 1 − ${penaltyPct}% × 档位 × (p − ${thresholdPct}%) / ${restPct}%`
        + '；档位：不出现 1.0 / 可接受 0.5 / 歌声 0'
    }

    function vocalAttitudeText(cue, data) {
      const entry = VOCAL_ATTITUDE[cue?.vocal ?? 'any']
      if (!entry) return ''
      if (data?.vocalEnabled === false) return `人声态度：${entry[0]}（识别已关闭）`
      if (entry[1] === 0) return `人声态度：${entry[0]}（不扣）`
      const penalty = Number.isFinite(Number(data?.vocalPenalty)) ? Number(data.vocalPenalty) : 0.6
      const shown = Math.round(penalty * entry[1] * 100)
      return `人声态度：${entry[0]}（最多 −${shown}%）`
    }

    /** 负向标签权重合计（用于算本段上限）。 */
    function sumWeights(list) {
      return Array.isArray(list) ? list.reduce((acc, item) => acc + (Number(item.weight) || 0), 0) : 0
    }

    /**
     * 目标匹配明细：每个 target 标签的概率 × 权重，以及基础分（Σw·p / Σw）。
     * 卡片上的「听感」三个标签是全局最高概率，不一定是本段目标；排序看的是这一行。
     */
    function targetMatchOf(cue, candidate) {
      const probs = candidate?.analysis?.probs
      const target = Array.isArray(cue?.target) ? cue.target : []
      if (!probs || target.length === 0) return { parts: [], base: null }
      let weighted = 0
      let used = 0
      const parts = []
      for (const item of target) {
        const weight = Number(item.weight)
        if (!Number.isFinite(weight) || weight <= 0) continue
        const raw = Number(probs[item.tag])
        const p = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : null
        if (p === null) {
          parts.push({ tag: item.tag, weight, p: null })
          continue
        }
        weighted += weight * p
        used += weight
        parts.push({ tag: item.tag, weight, p })
      }
      return { parts, base: used > 0 ? weighted / used : null }
    }

    /**
     * 负向标签的乘性惩罚：factor = 1 − k · Σ w⁻·p（与服务端 lib/score.js 同口径）。
     * 权重按实际数量归一化，所以 factor ≥ 1−k，分数不会被压成负数。
     */
    function avoidOf(cue, candidate, k) {
      const list = Array.isArray(cue?.avoidTargets) ? cue.avoidTargets : []
      const probs = candidate?.analysis?.probs
      if (list.length === 0 || !probs) return { factor: 1, parts: [] }
      const kk = Number.isFinite(Number(k)) && Number(k) > 0 ? Number(k) : 0.6
      let pressure = 0
      const parts = []
      for (const item of list) {
        const w = Number(item.weight)
        if (!Number.isFinite(w) || w <= 0) continue
        const raw = Number(probs[item.tag])
        const p = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0
        pressure += w * p
        parts.push({ tag: item.tag, weight: w, p, impact: kk * w * p })
      }
      return { factor: Math.max(0, 1 - kk * pressure), parts }
    }

    /**
     * 人声惩罚（乘性）：与 lib/score.js 的 vocalFactor 同口径。
     * cue.vocal = none 全额、any 半额、wordless 不罚；没有 vocal 概率就不罚。
     */
    function vocalOf(cue, candidate, { penalty = 0, threshold = 0.1 } = {}) {
      // 与服务端 lib/score.js 的 vocalFactor 同口径：
      // 档位由 cue.vocal 决定（none 1 / any 0.5 / wordless 0），p 只负责「踩多深」。
      const want = cue?.vocal ?? 'any'
      const scale = want === 'none' ? 1 : want === 'any' ? 0.5 : 0
      const p = Number(candidate?.analysis?.vocal)
      const t = Number(threshold)
      if (scale <= 0 || !Number.isFinite(p) || Number(penalty) <= 0) return { factor: 1, p, scale, threshold: t }
      const strength = Math.max(0, Math.min(1, (p - t) / (1 - t)))
      return { factor: Number((1 - Number(penalty) * scale * strength).toFixed(4)), p, scale, threshold: t }
    }

    /** 段内打分：base = Σ w·p / Σ w，再乘负向标签惩罚与人声惩罚（与服务端同口径）。 */
    function scoreOf(cue, candidate, k, vocal) {
      const probs = candidate?.analysis?.probs
      const target = cue?.target
      if (!probs || !Array.isArray(target) || target.length === 0) return null
      let weighted = 0
      let used = 0
      for (const item of target) {
        const w = Number(item.weight)
        if (!Number.isFinite(w) || w <= 0) continue
        const p = Number(probs[item.tag])
        if (!Number.isFinite(p)) continue
        weighted += w * Math.max(0, Math.min(1, p))
        used += w
      }
      if (used === 0) return null
      return Math.max(0, (weighted / used) * avoidOf(cue, candidate, k).factor * vocalOf(cue, candidate, vocal).factor)
    }

    function topOf(analysis, n = 3) {
      const probs = analysis?.probs
      if (!probs) return []
      return Object.entries(probs)
        .filter(([, p]) => Number.isFinite(Number(p)))
        .map(([tag, p]) => [tag, Number(p)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
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
     * 听感分析：段内得分 + 概率最高的几个原生标签。
     * 得分只在同一段内可比——它的定义就是「按这段的权重算出来的」。
     */
    function AnalysisTags({ analysis, score, labels = {} }) {
      if (!analysis) {
        return h('div', { className: 'bgm-c-auto' },
          h('span', { className: 'bgm-ai' }, '听感'),
          h('span', { className: 'bgm-ai-dim' }, '未分析（点上面的「分析听感」补）'))
      }
      if (analysis.error) {
        return h('div', { className: 'bgm-c-auto' },
          h('span', { className: 'bgm-ai' }, '听感'),
          h('span', { className: 'bgm-ai-dim' }, '拿不到音频，未分析'))
      }
      const top = topOf(analysis, 3)
      if (top.length === 0) return null
      const level = score == null ? 'unknown' : score >= 0.5 ? 'good' : score >= 0.25 ? 'fair' : 'poor'
      const unstable = Number(analysis.stability) > 0.25
      return h('div', { className: 'bgm-c-auto' },
        h('span', { className: 'bgm-ai' }, '听感'),
        h('span', {
          className: `bgm-ai-match ${level}`,
          title: '按这一段的目标权重算出的加权得分；只在段内可比'
        }, score == null ? '得分 —' : `得分 ${pct(score)}`),
        top.map(([tag, p], i) => h('span', { className: i === 0 ? 'bgm-ai-top' : 'bgm-ai-soft', key: tag }, `${labels[tag] ?? tag} ${pct(p)}`)),
        unstable ? h('span', { className: 'bgm-ai-dim', title: '多段之间差异大，这首的情绪不稳' }, '情绪不稳') : null)
    }

    /** 歌单历史里的一行。单独提出来，免得内联嵌套太深看不清括号。 */
    function HistoryRow({ item, onOpen }) {
      const subtitle = [
        item.module,
        item.session ? `第 ${item.session} 回` : '',
        `${item.tracks ?? 0} 首`,
        String(item.at ?? '').slice(0, 10)
      ].filter(Boolean).join(' · ')
      return h('div', { className: 'bgm-hist-row' },
        h('div', null,
          h('div', { className: 'bgm-hist-name' }, item.playlistName || item.module || '(未命名)'),
          h('div', { className: 'bgm-hist-sub' }, subtitle)),
        h('div', { className: 'bgm-actions' },
          item.jumpUrl
            ? h('a', { className: 'bgm-btn ghost', href: item.jumpUrl, target: '_blank', rel: 'noreferrer' }, '在 App')
            : null,
          item.exists
            ? h('button', { className: 'bgm-btn', onClick: () => onOpen(item) }, '打开')
            : h('span', { className: 'bgm-ai-dim' }, '文件已移走')))
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
      const [avoidDraft, setAvoidDraft] = useState({ tag: '', weight: 0.4 })
      const [newSheet, setNewSheet] = useState({ module: '', dir: '', session: '1', scope: 'main' })
      const [preview, setPreview] = useState(null)
      const [cookieInput, setCookieInput] = useState('')
      // 这几个必须在任何引用它们的 useEffect 之前声明：依赖数组是在渲染期求值的，
      // 声明靠后会让组件在拿到 useEffect 的 TDZ 上直接抛错（面板点开就是空白）。
      const [loginPhase, setLoginPhase] = useState('')   // '' | 'loading' | 'waiting' | 'scanned' | 'expired'
      const [qr, setQr] = useState(null)
      const [history, setHistory] = useState(null)
      const loginTimer = useRef(0)
      const stopLoginPoll = useCallback(() => {
        if (loginTimer.current) { clearTimeout(loginTimer.current); loginTimer.current = 0 }
      }, [])
      const audioRef = useRef(null)
      const toastTimer = useRef(0)
      const seekingRef = useRef(false)
      const lastSeekRef = useRef(0)
      // 音频还没 loadedmetadata 时点了进度条：先记下比例，等就绪再跳
      const pendingSeekRef = useRef(null)
      // Electron 里 HTTP 流可能报 seekable=0；把音频取成 Blob 再放，本地 Blob 一定能跳
      const blobUrlRef = useRef(new Map())

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

      const avoidTargets = Array.isArray(cue?.avoidTargets) ? cue.avoidTargets : []
      // 设置里关掉后：不打分（k=0 → factor 恒为 1），界面也不显示编辑区
      const avoidEnabled = data?.avoidEnabled !== false
      const avoidK = avoidEnabled ? (Number(data?.avoidK) || 0.6) : 0
      // 人声惩罚参数：设置里关掉识别时 penalty=0（不惩罚）
      const vocalOpts = {
        penalty: data?.vocalEnabled === false ? 0 : (Number.isFinite(Number(data?.vocalPenalty)) ? Number(data.vocalPenalty) : 0.6),
        threshold: Number.isFinite(Number(data?.vocalThreshold)) ? Number(data.vocalThreshold) : 0.1
      }
      // 下拉里只放还没被用过的标签
      const avoidTagChoices = Object.keys(data?.tagLabels ?? {})
        .filter((tag) => !avoidTargets.some((item) => item.tag === tag))
        .sort((a, b) => String(data?.tagLabels?.[a] ?? a).localeCompare(String(data?.tagLabels?.[b] ?? b), 'zh'))

      /** 候选排序：已选置顶，其余按「与这段的听感得分」降序。 */
      const listed = useMemo(() => {
        const arr = [...(cue?.candidates ?? [])]
        const pickedId = cue?.picks?.primary?.song_id
        return arr.sort((a, b) => {
          if (a.song_id === pickedId) return -1
          if (b.song_id === pickedId) return 1
          return (scoreOf(cue, b, avoidK, vocalOpts) ?? -1) - (scoreOf(cue, a, avoidK, vocalOpts) ?? -1)
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [cue?.id, cue?.candidates, cue?.picks, cue?.target])

      /** 整组都分析过、且都低于 0.25，才算「召回失败」，这时才值得换词重搜。 */
      const groupWeak = listed.length > 0
        && listed.every((c) => c.analysis?.probs)
        && listed.every((c) => (scoreOf(cue, c, avoidK, vocalOpts) ?? 0) < 0.25)

      useEffect(() => {
        setEditing(false)
        setDraft({ scene: cue?.scene ?? '', trigger: cue?.trigger ?? '' })
      }, [cue?.id])

      useEffect(() => () => {
        for (const url of blobUrlRef.current.values()) {
          try { URL.revokeObjectURL(url) } catch { /* 已释放 */ }
        }
        blobUrlRef.current.clear()
      }, [])

      const objectUrlFor = useCallback(async (songId) => {
        const cache = blobUrlRef.current
        if (cache.has(songId)) return cache.get(songId)
        const response = await fetch(audioUrl(songId))
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const buffer = await response.arrayBuffer()
        if (buffer.byteLength < 20000) throw new Error('音频过短')
        const type = response.headers.get('content-type') || 'audio/mpeg'
        const url = URL.createObjectURL(new Blob([buffer], { type }))
        cache.set(songId, url)
        // 留最近 8 首：切歌来回跳时不该每次都重新下（128k 一首约 4MB）
        while (cache.size > 8) {
          const oldest = cache.keys().next().value
          const oldUrl = cache.get(oldest)
          cache.delete(oldest)
          try { URL.revokeObjectURL(oldUrl) } catch { /* 已释放 */ }
        }
        return url
      }, [])

      const play = useCallback(async (candidate) => {
        const audio = audioRef.current
        if (!audio) return
        if (playing.songId === candidate.song_id) {
          if (isPlaying) { audio.pause(); return }
          try { await audio.play() } catch { /* onError 会说明原因 */ }
          return
        }
        setPlaying({ songId: candidate.song_id, title: candidate.title, artist: candidate.artist })
        try {
          // 走 Blob：桌面版里 HTTP 流可能报 seekable=0，换成 Blob 后必然可跳
          audio.src = await objectUrlFor(candidate.song_id)
        } catch (error) {
          console.debug?.('[bgm-prep] blob fetch failed, fallback to stream', error)
          audio.src = audioUrl(candidate.song_id)
        }
        try { await audio.play() } catch { /* onError 会说明原因 */ }
      }, [playing.songId, isPlaying, objectUrlFor])

      /**
       * 进度条跳转。时长直接读 audio.duration，不依赖 progress 状态（状态可能还没刷到）。
       * 命中区是 16px 高的条容器，视觉上的细线由内部 track/fill 画。
       */
      const seekFromEvent = useCallback((event, { throttle = false } = {}) => {
        const audio = audioRef.current
        if (!audio) return
        const now = Date.now()
        if (throttle && now - lastSeekRef.current < 80) return
        // 先记这次尝试：失败时 click 兜底就不会再弹一次同样的提示
        lastSeekRef.current = now
        const rect = event.currentTarget.getBoundingClientRect()
        if (!rect.width) return
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
        const duration = Number(audio.duration)
        // 800ms 后核对是否真的跳了；没跳就报出 media 状态，方便定位桌面内核差异
        const verify = (targetSeconds) => {
          setTimeout(() => {
            if (Math.abs(audio.currentTime - targetSeconds) <= 1.5) return
            const end = audio.seekable.length > 0 ? audio.seekable.end(0) : 0
            const info = `duration=${Number.isFinite(audio.duration) ? audio.duration.toFixed(1) : String(audio.duration)}`
              + ` readyState=${audio.readyState} seekable=${end.toFixed(1)}`
            console.debug?.('[bgm-prep] seek not applied', info)
            notify(`跳转未生效（${info}）`)
          }, 800)
        }
        const seekTo = (target) => {
          try {
            const seconds = target * duration
            audio.currentTime = seconds
            console.debug?.('[bgm-prep] seek', { ratio: target, duration, to: audio.currentTime })
            verify(seconds)
          } catch (error) {
            console.debug?.('[bgm-prep] seek failed', error)
            notify(`跳转失败：${error?.message ?? error}`)
          }
        }
        if (Number.isFinite(duration) && duration > 0) {
          pendingSeekRef.current = null
          seekTo(ratio)
          return
        }
        // 时长还没出来：如果已经选了歌，就等 metadata 到了自动跳；否则提示先试听
        if (playing.songId !== 0 && playing.songId !== undefined) {
          pendingSeekRef.current = ratio
          const retry = () => {
            const ready = Number(audio.duration)
            if (!Number.isFinite(ready) || ready <= 0) return
            audio.removeEventListener('loadedmetadata', retry)
            audio.removeEventListener('canplay', retry)
            const target = pendingSeekRef.current
            pendingSeekRef.current = null
            if (target != null) {
              try {
                const seconds = target * ready
                audio.currentTime = seconds
                console.debug?.('[bgm-prep] seek after metadata', { ratio: target, duration: ready })
                verify(seconds)
              } catch (error) {
                notify(`跳转失败：${error?.message ?? error}`)
              }
            }
          }
          audio.addEventListener('loadedmetadata', retry)
          audio.addEventListener('canplay', retry)
          notify('音频还在加载，就绪后自动跳到点击的位置')
          return
        }
        notify('先点一首歌的「试听」按钮，再点进度条')
      }, [notify, playing.songId])

      const act = useCallback(async (label, fn) => {
        setBusy(label)
        try { await fn() } catch (err) { notify(err.message) } finally { setBusy('') }
      }, [notify])

      /** 保存整组负向标签（增删/改权重都发整组，权重由服务端按数量归一化）。 */
      const saveAvoid = useCallback((list) => act('avoid', async () => {
        const next = await callApi('patch-cue', { file: data.active, cueId: cue?.id, avoidTargets: list })
        setData(next)
      }), [act, data?.active, cue?.id])

      const setAvoidWeight = useCallback((tag, raw) => {
        const list = Array.isArray(cue?.avoidTargets) ? cue.avoidTargets : []
        const weight = Math.max(0.1, Math.min(1, Number(raw) || 0.1))
        if (list.some((item) => item.tag === tag && Number(item.weight) === weight)) return
        saveAvoid(list.map((item) => (item.tag === tag ? { tag: item.tag, weight } : item)))
      }, [cue?.avoidTargets, saveAvoid])

      const addAvoid = useCallback(() => {
        const tag = String(avoidDraft.tag ?? '').trim()
        if (tag === '') return
        const list = Array.isArray(cue?.avoidTargets) ? cue.avoidTargets : []
        if (list.some((item) => item.tag === tag)) return
        const weight = Math.max(0.1, Math.min(1, Number(avoidDraft.weight) || 0.4))
        saveAvoid([...list, { tag, weight }])
        setAvoidDraft({ tag: '', weight: avoidDraft.weight })
      }, [avoidDraft, cue?.avoidTargets, saveAvoid])

      /** 负向标签总开关（设置里）。关掉后打分不乘惩罚，检索也不按标题关键词筛。 */
      const toggleAvoid = useCallback((enabled) => act('avoid-setting', async () => {
        await callApi('avoid-setting', { enabled })
        await load()
        notify(enabled ? '已启用负向标签' : '已关闭负向标签')
      }), [act, load, notify])

      /** 试听音质：只管「点一下多久响」，与分析用的 quality 是两条线。 */
      const setPreviewQuality = useCallback((quality) => act('preview-setting', async () => {
        await callApi('preview-setting', { quality })
        await load()
        notify(`试听音质已改为 ${quality === 'lossless' ? '无损' : quality === 'high' ? '320k' : '128k'}`)
      }), [act, load, notify])

      /** 人声识别总开关：关掉后不跑 CLAP，也不按人声压低分数。 */
      const toggleVocal = useCallback((enabled) => act('vocal-setting', async () => {
        await callApi('vocal-setting', { enabled })
        await load()
        notify(enabled ? '已启用人声识别' : '已关闭人声识别')
      }), [act, load, notify])

      /** 人声参数：扣减上限（0–0.6）与起罚线（0–0.95），写进 settings.json 的 analysis.vocal。 */
      const setVocalParam = useCallback((patch) => act('vocal-param', async () => {
        await callApi('vocal-setting', patch)
        await load()
        notify('已更新人声识别参数')
      }), [act, load, notify])

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

      const openHistory = useCallback(() => act('history', async () => {
        const data2 = await callApi('history', {})
        setHistory(data2)
        setDialog('history')
      }), [act])

      const doTag = useCallback((cueIds) => act('tag', async () => {
        const result = await callApi('tag', { file: data.active, cueIds, perCue: 8 })
        setData(result.sheet)
        let extra = result.failed > 0 ? `，${result.failed} 首失败` : ''
        if (result.remaining > 0) extra += `，还剩 ${result.remaining} 首（再点一次继续）`
        notify(`已分析 ${result.analyzed} 首（缓存命中 ${result.cached ?? 0}）${extra}`)
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
      // 表读失败时服务端给的是 {active, sheet:null, error}：不能把 active 有值当成「有表」，
      // 否则会渲染成一个 0 段的空表，用户只看到空白、看不到原因（I6）。
      const loadError = typeof data.error === 'string' ? data.error : ''
      const hasSheet = Boolean(data.active) && data.sheet !== null && loadError === ''

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
            // 负向标签总开关：关闭后打分不乘惩罚，检索也不按标题关键词筛
            h('div', { className: 'bgm-field', style: { marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 } },
              h('label', null, '负向标签'),
              h('label', {
                style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }
              },
              h('input', {
                type: 'checkbox',
                checked: avoidEnabled,
                disabled: busy !== '',
                onChange: (e) => toggleAvoid(e.target.checked)
              }),
              '启用（关闭后不按标签扣分，也不做标题关键词筛）')),
            // 试听音质：默认 128k，一首约 4MB，点了就响；无损要等整首下完
            h('div', { className: 'bgm-field', style: { marginTop: 10 } },
              h('label', null, '试听音质'),
              h('div', {
                style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--muted)' }
              },
              h('select', {
                value: data.previewQuality || 'standard',
                disabled: busy !== '',
                onChange: (e) => setPreviewQuality(e.target.value)
              },
              h('option', { value: 'standard' }, '128k（最快，约 4MB/首）'),
              h('option', { value: 'high' }, '320k（约 10MB/首）'),
              h('option', { value: 'lossless' }, '无损（最慢，20~32MB/首）')))),
            // 人声识别：CLAP 零样本；关掉后不探测、不惩罚
            h('div', { className: 'bgm-field', style: { marginTop: 10 } },
              h('label', null, '人声识别'),
              h('label', {
                style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--muted)', cursor: 'pointer' }
              },
              h('input', {
                type: 'checkbox',
                checked: data.vocalEnabled !== false,
                disabled: busy !== '',
                onChange: (e) => toggleVocal(e.target.checked)
              }),
              '启用（CLAP 零样本；识别到「有人在唱」时按 cue.vocal 压低分数）')),
            // 两个可调参数：罚多重（penalty）与从哪开始罚（threshold）
            h('div', {
              className: 'bgm-row',
              style: { marginTop: 6, gap: 10, alignItems: 'center', flexWrap: 'wrap' }
            },
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)' } },
              '扣减上限',
              h('input', {
                type: 'number', className: 'bgm-avoid-num', min: 0, max: 60, step: 1,
                defaultValue: Math.round(Number(data.vocalPenalty ?? 0.6) * 100),
                disabled: busy !== '' || data.vocalEnabled === false,
                title: '人声拉满（p=1）时最多扣多少；对应 settings 的 analysis.vocal.penalty（0–0.6）',
                onBlur: (e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) setVocalParam({ penalty: Math.min(0.6, Math.max(0, v / 100)) })
                }
              }),
              '%'),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)' } },
              '起罚线 p ≥',
              h('input', {
                type: 'number', className: 'bgm-avoid-num', min: 0, max: 95, step: 1,
                defaultValue: Math.round(Number(data.vocalThreshold ?? 0.1) * 100),
                disabled: busy !== '' || data.vocalEnabled === false,
                title: '人声概率低于这条线就不扣（百分比）；对应 settings 的 analysis.vocal.threshold',
                onBlur: (e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) setVocalParam({ threshold: Math.min(0.95, Math.max(0, v / 100)) })
                }
              }),
              '%'),
            h('span', { className: 'bgm-hint' }, '改完刷新即生效；不重算已有分析')),
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
            : dialog === 'history' ? h('div', { className: 'bgm-dialog' },
              h('h3', null, '历史'),
              h('p', { className: 'bgm-hint' }, '上半是建过的歌单（每次建歌单记一条）；下半是最近打开过的曲目表，测试或没建过歌单的表在这里。'),
              h('div', { className: 'bgm-hist' },
                h('div', { className: 'bgm-section' }, '建过的歌单'),
                (history?.playlists ?? []).length === 0
                  ? h('div', { className: 'bgm-empty' }, '还没有建过歌单')
                  : (history?.playlists ?? []).map((item) => h(HistoryRow, {
                    key: item.file,
                    item,
                    onOpen: (target) => act('open-hist', async () => {
                      const next = await callApi('open', { file: target.file })
                      setData(next)
                      setDialog('')
                      notify(`已打开：${target.module || target.file}`)
                    })
                  })),
                (history?.recent ?? []).length > 0
                  ? h('div', { style: { marginTop: 12, textAlign: 'left' } },
                    h('div', { className: 'bgm-section' }, '最近打开'),
                    (history?.recent ?? []).map((r) => h('div', {
                      key: r.file,
                      style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }
                    },
                    h('span', {
                      style: { flex: 1, fontSize: 11, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                      title: r.file
                    }, r.file),
                    h('button', {
                      className: 'bgm-btn ghost',
                      onClick: () => act('open-recent', async () => {
                        const next = await callApi('open', { file: r.file })
                        setData(next)
                        setDialog('')
                        notify('已打开最近那份曲目表')
                      })
                    }, tr('open')))))
                  : null),
              h('div', { className: 'bgm-dialog-foot' },
                h('button', { className: 'bgm-btn ghost', onClick: () => setDialog('') }, '关闭')))
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
          h('button', { className: 'bgm-btn ghost', disabled: busy !== '', onClick: openHistory }, '历史'),
          // 登录入口直接摆在顶栏：没登录时就是一颗明确的「登录网易云」，点了立刻出二维码。
          data.hasCookie
            ? h('button', {
              className: 'bgm-btn ghost',
              title: '播放设置：查看、更换或清除播放凭据',
              onClick: () => setDialog('settings')
            }, `已登录${data.nickname ? `·${data.nickname}` : ''}`)
            : h('button', {
              className: 'bgm-btn',
              title: '扫码登录网易云，解锁会员曲试听与听感分析',
              onClick: () => { setDialog('settings'); void startNeteaseLogin() }
            }, '登录网易云'),
          hasSheet ? h('button', { className: 'bgm-btn', disabled: busy !== '', onClick: () => doTag() },
            busy === 'tag' ? '分析中…' : '分析听感') : null,
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
                loadError
                  ? h('div', null,
                    h('div', { style: { color: 'var(--danger, #fca5a5)', marginBottom: 8 } }, loadError),
                    h('div', null, '从左侧「最近打开」里选一份，或者新建一份曲目表。'))
                  : hasSheet ? h('div', null, tr('addCue')) : h('div', null, tr('emptyHint')))
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
                  cue.need_bgm ? h('span', { className: 'bgm-tag', key: 'vocal-attitude' }, vocalAttitudeText(cue, data)) : null,
                  targetChips(cue.target, data?.tagLabels).map((label) => h('span', { className: 'bgm-tag', key: label }, label)),
                  cue.targetSource === 'none' && cue.need_bgm
                    ? h('span', {
                      className: 'bgm-tag warn',
                      title: '这段的中文描述没有对上任何关键词，目标先用 calm；建议手改 target'
                    }, '描述未命中标签')
                    : null,
                  Array.isArray(cue.targetDropped) && cue.targetDropped.length > 0
                    ? h('span', {
                      className: 'bgm-tag warn',
                      title: '这些标签不在模型的 56 个词里，已丢弃'
                    }, `已丢弃 ${cue.targetDropped.map((t) => (data?.tagLabels?.[t] ?? t)).join(' / ')}`)
                    : null,
                  cue.need_bgm ? null : h('span', { className: 'bgm-tag green' }, tr('noBgmLater')),
                  Array.isArray(cue.wants) && cue.wants.length > 0
                    ? h('span', { className: 'bgm-tag', key: 'wants' }, cue.wants[0]) : null,
                  // 落不到标签上的负向描述：字面关键词（按标题筛）与「无法验证」照实标出
                  ...(Array.isArray(cue.avoidKeywords) && cue.avoidKeywords.length > 0
                    ? [h('span', { className: 'bgm-tag warn', key: 'avoid-kw', title: '标题/专辑里出现这些词会被压低' },
                      `负向关键词：${cue.avoidKeywords.slice(0, 3).join('/')}（按标题筛）`)]
                    : []),
                  ...(Array.isArray(cue.avoidUnverified) ? cue.avoidUnverified.map((text) => h('span', {
                    className: 'bgm-tag warn',
                    key: `avoid-x-${text}`,
                    title: '模型测不出来的负向关键词，只能试听时人工判断'
                  }, `无法验证：${text}`)) : [])),

                // 公式说明：放在段头，不跟每行候选重复；数字跟随 settings 的 penalty/threshold
                cue.need_bgm ? h('div', { className: 'bgm-hint', style: { marginTop: 4 } }, vocalFormulaHint(data)) : null,

                // 负向标签编辑区：数量和权重由 agent 按场景给，人也可以增删、直接改权重
                cue.need_bgm ? h('div', { className: 'bgm-avoid' },
                  h('span', { className: 'bgm-avoid-label' }, '负向标签：'),
                  !avoidEnabled
                    ? h('span', { className: 'bgm-tag' }, '已关闭（设置里可重新启用）')
                    : (avoidTargets.length === 0
                      ? h('span', { className: 'bgm-tag' }, '（未设置）')
                      : avoidTargets.map((item) => h('span', {
                        className: 'bgm-tag warn bgm-avoid-chip',
                        key: `avoid-${item.tag}`
                      },
                      h('span', { className: 'bgm-avoid-name' },
                        `${data?.tagLabels?.[item.tag] ?? item.tag} ${pct(item.weight)}`),
                      h('input', {
                        type: 'number',
                        className: 'bgm-avoid-num',
                        min: 10, max: 100, step: 10,
                        value: Math.round(Number(item.weight) * 100),
                        title: '这个标签的权重（百分比；保存后按本段实际数量重新归一化）',
                        'aria-label': `${data?.tagLabels?.[item.tag] ?? item.tag} 权重（百分比）`,
                        onChange: (e) => setAvoidWeight(item.tag, Number(e.target.value) / 100)
                      }),
                      h('span', {
                        className: 'bgm-avoid-x',
                        title: '移除这个负向标签',
                        onClick: (e) => {
                          e.stopPropagation()
                          saveAvoid(avoidTargets.filter((x) => x.tag !== item.tag))
                        }
                      }, '×')))),
                  avoidEnabled
                    ? h('span', { className: 'bgm-tag', title: 'k × Σ权重：这段最多能把基础分压低多少' },
                      `合计上限 ${Math.round(avoidK * sumWeights(avoidTargets) * 100)}%`)
                    : null,
                  avoidEnabled ? h('span', { className: 'bgm-grow' }) : null,
                  avoidEnabled ? h('select', {
                    className: 'bgm-input bgm-avoid-pick',
                    value: avoidDraft.tag,
                    onChange: (e) => setAvoidDraft({ ...avoidDraft, tag: e.target.value }),
                    'aria-label': '选择负向标签'
                  },
                  h('option', { value: '' }, '选一个标签…'),
                  ...avoidTagChoices.map((tag) => h('option', { key: tag, value: tag }, data?.tagLabels?.[tag] ?? tag))) : null,
                  avoidEnabled ? h('input', {
                    type: 'number', className: 'bgm-avoid-num', min: 10, max: 100, step: 10,
                    value: Math.round(avoidDraft.weight * 100),
                    title: '相对权重（百分比；服务端会按本段负向标签数量归一化）',
                    'aria-label': '新负向标签权重（百分比）',
                    onChange: (e) => setAvoidDraft({ ...avoidDraft, weight: Number(e.target.value) / 100 })
                  }) : null,
                  avoidEnabled ? h('button', {
                    className: 'bgm-btn ghost', disabled: busy !== '' || avoidDraft.tag === '',
                    onClick: addAvoid
                  }, '添加负向标签') : null) : null,

                h('div', { className: 'bgm-section' },
                  `${(cue.candidates ?? []).length} 首候选`,
                  h('div', { className: 'bgm-grow' }),
                  groupWeak ? h('button', {
                    className: 'bgm-btn ghost', disabled: busy !== '',
                    onClick: () => act('refetch', async () => {
                      const result = await callApi('refetch-by-tag', { file: data.active, cueId: cue.id })
                      setData(result.sheet)
                      notify(`换词重搜「${result.query}」，新候选 ${result.fetched} 首`)
                    })
                  }, busy === 'refetch' ? '重搜中…' : '这组都不对味 · 换词重搜') : null,
                  h('button', {
                    className: 'bgm-btn ghost', disabled: busy !== '' || (cue.candidates ?? []).length === 0,
                    onClick: () => doTag([cue.id])
                  }, busy === 'tag' ? '分析中…' : '分析听感'),
                  h('button', {
                    className: 'bgm-btn ghost', disabled: busy !== '',
                    onClick: () => fetchCue([cue.id], (cue.candidates ?? []).length > 0)
                  }, busy === 'fetch' ? tr('fetching') : tr('fetchOne'))),

                h('div', { className: 'bgm-list' },
                  (cue.candidates ?? []).length === 0
                    ? h('div', { className: 'bgm-empty' }, tr('noCandidate'))
                    : listed.map((candidate) => {
                      const isPicked = cue.picks?.primary?.song_id === candidate.song_id
                      const isCurrent = playing.songId === candidate.song_id && isPlaying
                      const score = scoreOf(cue, candidate, avoidK, vocalOpts)
                      const weak = score != null && score < 0.25
                      const avoid = avoidOf(cue, candidate, avoidK)
                      const targetMatch = targetMatchOf(cue, candidate)
                      const vocalInfo = vocalOf(cue, candidate, vocalOpts)
                      // 开关关闭（avoidK=0）时不展示负向行，避免出现「−0%」
                      const hits = avoidK > 0 ? avoid.parts.filter((p) => p.p > 0) : []
                      return h('div', { className: `bgm-cand${isPicked ? ' picked' : ''}${weak ? ' weak' : ''}`, key: candidate.song_id },
                        h('button', {
                          className: `bgm-play${isCurrent ? ' on' : ''}`,
                          'aria-label': isCurrent ? tr('stop') : tr('audition'),
                          title: isCurrent ? tr('stop') : tr('audition'),
                          onClick: () => void play(candidate)
                        }, h(PlayGlyph, { playing: isCurrent })),
                        h('div', null,
                          h('div', { className: 'bgm-c-name' }, candidate.title),
                          h('div', { className: 'bgm-c-sub' }, [candidate.artist, candidate.album, clock(candidate.duration)].filter(Boolean).join(' · ')),
                          h(AnalysisTags, { analysis: candidate.analysis, score, labels: data?.tagLabels }),
                          // 目标匹配：本段 target 的每个标签概率×权重 → 基础分（排序就按它算）
                          targetMatch.base != null
                            ? h('div', { className: 'bgm-c-target' },
                              '目标匹配 ',
                              targetMatch.parts.map((p) => `${data?.tagLabels?.[p.tag] ?? p.tag} `
                                + `${p.p == null ? '—' : pct(p.p)}×${pct(p.weight)}`).join(' · '),
                              ` → 基础 ${pct(targetMatch.base)}`)
                            : null,
                          // 每个负向标签各自压了多少（percent of base），不去重、不合并
                          hits.length > 0
                            ? h('div', { className: 'bgm-c-avoid' },
                              `负向标签 −${Math.round((1 - avoid.factor) * 100)}%：`,
                              hits.map((p) => `−${Math.round(p.impact * 100)}% ${data?.tagLabels?.[p.tag] ?? p.tag}`).join(' · '))
                            : null,
                          // 人声概率与惩罚：只在真的被压时显示，避免每行都刷「×1.00」
                          vocalInfo.factor < 1
                            ? h('div', {
                              className: 'bgm-c-vocal',
                              title: `${vocalFormulaHint(data)}；本首 p=${pct(vocalInfo.p)}，p ≥ ${pct(vocalInfo.threshold)} 才进入计算`
                            },
                              `人声 ${pct(vocalInfo.p)} → ×${pct(vocalInfo.factor)}`)
                            : null,
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
              role: 'slider',
              'aria-label': '播放进度',
              'aria-valuemin': 0,
              'aria-valuemax': Math.round(progress.total || 0),
              'aria-valuenow': Math.round(progress.current || 0),
              tabIndex: 0,
              title: '点击或按住拖动跳转（方向键 ±5 秒）',
              onPointerDown: (e) => {
                seekingRef.current = true
                try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 老内核忽略 */ }
                seekFromEvent(e)
              },
              // 桌面版（Electron）里若指针事件被窗口拖拽区吞掉，鼠标事件仍可能到达；80ms 内不重复
              onMouseDown: (e) => {
                if (Date.now() - lastSeekRef.current > 80) seekFromEvent(e)
              },
              onPointerMove: (e) => { if (seekingRef.current) seekFromEvent(e, { throttle: true }) },
              // 抬起时再跳一次：覆盖「按下时还在加载、metadata 刚就绪」的情况
              onPointerUp: (e) => {
                if (!seekingRef.current) return
                seekingRef.current = false
                seekFromEvent(e)
              },
              onPointerCancel: () => { seekingRef.current = false },
              onKeyDown: (e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                const audio = audioRef.current
                const duration = Number(audio?.duration)
                if (!audio || !Number.isFinite(duration) || duration <= 0) return
                e.preventDefault()
                const delta = e.key === 'ArrowLeft' ? -5 : 5
                audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + delta))
              },
              // 某些环境里指针事件可能被上层吞掉，留一个 click 兜底（500ms 内已按过就不再重复跳）
              onClick: (e) => { if (Date.now() - lastSeekRef.current > 500) seekFromEvent(e) }
            },
            h('div', { className: 'bgm-bar-track' }),
            h('div', { className: 'bgm-bar-fill', style: { width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` } })),
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
      __internals: { NS, PAGE_ID, API, callApi, audioUrl, clock, targetChips, scoreOf, Workbench, SidebarIcon, goBack, zh, en }
    }
  }
})
























