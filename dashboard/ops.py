#!/usr/bin/env python3
"""MEGAPHONE OPS DASHBOARD — see everything at a glance.
Reads the live books + watchlists + engine locks and serves one dark page.
Run:  /c/Python311/python.exe -m uvicorn ops:app --host 127.0.0.1 --port 8080
"""
import json, os, time
from pathlib import Path
from fastapi import FastAPI
from fastapi.responses import HTMLResponse

app = FastAPI()

MEG = Path(r"D:\megaphone")
COPY_DIR = MEG / ".copy1"
DEV_DIR = MEG / ".dev1"
DISCOVERY = Path(r"C:\Users\ellio\gmgn-demos\discover.py")

def load(p):
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:
        return None

def lock_pid(lockfile):
    try:
        pid = lockfile.read_text("utf-8").strip()
        if not pid:
            return None
        # Windows process-existence check via OpenProcess (no permissions needed)
        import ctypes
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        h = ctypes.windll.kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
        if h:
            ctypes.windll.kernel32.CloseHandle(h)
            return pid
        return None
    except Exception:
        return None

def book_stats(trades):
    if not trades:
        return {"n": 0, "open": 0, "win": 0, "stop": 0, "hissell": 0, "void": 0, "net_pnl_pct": 0}
    n = len(trades)
    out = {"n": n, "open": 0, "win": 0, "stop": 0, "hissell": 0, "void": 0, "net_pnl_pct": 0}
    pnls = []
    for t in trades:
        o = t.get("outcome", "?")
        out[o.lower() if o.lower() in out else "void"] += 1
        if o in ("WIN", "STOP", "HISSELL") and t.get("pnlPct") is not None:
            pnls.append(float(t["pnlPct"]))
    out["net_pnl_pct"] = round(sum(pnls), 1) if pnls else 0
    out["winrate"] = round(100 * out["win"] / max(1, out["win"] + out["stop"]), 0)
    return out

def callout_summary():
    """Latest snapshot from rewards-tracker (rewards.jsonl) — the account's callouts + multiples."""
    p = MEG / ".megaphone" / "rewards.jsonl"
    if not p.exists():
        return {"total": 0, "rows": []}
    last = None
    try:
        for line in p.read_text("utf-8").splitlines():
            if line.strip():
                last = json.loads(line)
    except Exception:
        return {"total": 0, "rows": []}
    if not last:
        return {"total": 0, "rows": []}
    rows = [{"symbol": (r.get("symbol") or r.get("mint") or "?")[:10], "mc": r.get("mc") or 0,
             "x": round(float(r.get("multiple") or 1), 2), "peak": round(float(r.get("maxMult") or 1), 2),
             "views": r.get("views") or 0, "thesis": (r.get("thesis") or "")[:38],
             "ts": r.get("createdAt") or r.get("ts") or 0} for r in (last.get("rows") or [])[:12]]
    return {"total": last.get("total") or 0, "active": last.get("active") or 0,
            "resolved": last.get("resolved") or 0, "best": last.get("best") or 0,
            "totalViews": last.get("totalViews") or 0, "rows": rows}

@app.get("/api/state")
def state():
    copy_book = load(COPY_DIR / "copybook.json") or []
    dev_book = load(DEV_DIR / "devbook.json") or []
    watchlist = load(DEV_DIR / "dev-watchlist.json") or {"devs": []}
    copy_wallet = os.environ.get("COPY_WATCH_WALLET", "Gfsk5ZojnHSLoxRhUBD5vviJELFuTGkyBh9QTqEo7Ehg")

    copy_alive = bool(lock_pid(COPY_DIR / "copy-watch.lock"))
    dev_alive = bool(lock_pid(DEV_DIR / "dev-watch.lock"))

    # recent events (merged, sorted by time desc)
    events = []
    for t in (copy_book or []):
        ts = t.get("openedAt") or t.get("resolvedAt") or 0
        if ts:
            events.append({"t": ts, "kind": "COPY", "mint": (t.get("mint") or "?")[:10],
                           "outcome": t.get("outcome"), "pnl": t.get("pnlPct")})
    for t in (dev_book or []):
        ts = t.get("openedAt") or t.get("resolvedAt") or 0
        if ts:
            events.append({"t": ts, "kind": "DEV", "mint": (t.get("mint") or "?")[:10],
                           "outcome": t.get("outcome"), "pnl": t.get("pnlPct")})
    events.sort(key=lambda e: e["t"], reverse=True)

    return {
        "engines": {
            "copy": {"alive": copy_alive, "wallet": copy_wallet, "book": book_stats(copy_book), "trades": (copy_book or [])[-12:]},
            "dev": {"alive": dev_alive, "devs": len((watchlist.get("devs") or [])), "book": book_stats(dev_book), "trades": (dev_book or [])[-12:]},
        },
        "devs_top": (watchlist.get("devs") or [])[:10],
        "events": events[:15],
        "callouts": callout_summary(),
        "ideas": [
            {"name": "Callout Auto-Poster", "status": "⏳ GATE", "desc": "Post engine signals as pump.fun callouts (POST /callout/create VERIFIED). Needs ≥$1 token holdings in session wallet.", "owner": "founder buy $5"},
            {"name": "Token Launch + Blast", "status": "💡 IDEA", "desc": "Bundle-launch coins (pumpdev /api/create-bundle) + volume/bump to top. Reddit-validated $300-1K/launch claim. Risk: rug-rep.", "owner": "later"},
            {"name": "Bump Bot", "status": "💡 IDEA", "desc": "Automated small buys to keep a coin trending on pump.fun (Plankton-style).", "owner": "later"},
            {"name": "Padre Affiliate", "status": "💡 PARKED", "desc": "Pump.fun-owned terminal (ex-Padre). 35% fee-cashback referral program; links /rk/getbonus + /rk/backdoor LIVE. Monetize AFTER audience exists (fee-based, needs active traders).", "owner": "later"},
            {"name": "Landing Pages", "status": "💡 IDEA", "desc": "SEO/content pages pushing Padre/terminal affiliate links (like padreapp.com model — independent referral page). Cheap, compounds, needs traffic.", "owner": "later"},
            {"name": "Meta Ads (FB/IG)", "status": "💡 IDEA", "desc": "Paid social for affiliate links. Crypto ads often restricted; needs pixel + audience testing. $/click unclear — test $50.", "owner": "later"},
            {"name": "Google Ads", "status": "💡 IDEA", "desc": "Search ads on 'padre terminal', 'memecoin terminal' keywords. Crypto approval risk; CPC likely $1-5. Test $50.", "owner": "later"},
            {"name": "Giveaways", "status": "💡 IDEA", "desc": "SOL/coin giveaways for follow+RT to grow callout audience (founder's idea). Risk: X spam-filter + unfollow-audit waves. Use sparingly.", "owner": "later"},
            {"name": "Cross-Promo", "status": "💡 IDEA", "desc": "YouTube/TikTok/IG content about callout track record → funnel to pump.fun profile + affiliate links. Highest trust, slowest.", "owner": "later"},
            {"name": "Volume Bot", "status": "💡 IDEA", "desc": "Generate volume on launched coins via multi-wallet buys (commenter: $100K total).", "owner": "later"},
            {"name": "Auto-Sniper + Stop-Loss", "status": "🟡 PARTIAL", "desc": "Paper logic exists (copy engine). Needs real-execution wiring via pumpdev trade API.", "owner": "later"},
            {"name": "Dev Monitor", "status": "✅ DONE", "desc": "dev-watch: tracks 30 known-good dev wallets for new launches. Live.", "owner": "pumpy"},
            {"name": "Whale Copy Engine", "status": "✅ LIVE", "desc": "Gfsk5Zoj paper copy, +100/-30, copy-exit, glitch guards, honest book.", "owner": "pumpy"},
            {"name": "GMGN Discovery", "status": "✅ DONE", "desc": "Smart-money + dev open-ratio ranking via gmgn-cli. Dashboard :8000.", "owner": "pumpy"},
            {"name": "OPS Dashboard", "status": "✅ LIVE", "desc": "This board — engines, books, watchlists, events.", "owner": "pumpy"},
        ],
        "ts": time.strftime("%H:%M:%S"),
    }

HTML = """<!doctype html><html><head><meta charset="utf-8"><title>MEGAPHONE OPS</title>
<style>
:root{--bg:#0b0e14;--card:#11161f;--line:#1e2733;--txt:#d7e0ea;--dim:#5b6b7d;--grn:#2fe37e;--red:#ff5c5c;--yel:#ffc44d;--blu:#4da3ff}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font:13px/1.45 'Cascadia Code','JetBrains Mono',Consolas,monospace;padding:18px}
h1{font-size:16px;letter-spacing:2px;color:var(--dim);margin-bottom:14px}
h1 b{color:var(--txt)} .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px}
.card h2{font-size:11px;letter-spacing:1.5px;color:var(--dim);text-transform:uppercase;margin-bottom:10px}
.kv{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed #1a2330}
.kv:last-child{border-bottom:none} .v{color:var(--txt)}
table{width:100%;border-collapse:collapse;font-size:12px}
th{color:var(--dim);text-align:left;font-weight:normal;letter-spacing:.5px;padding:4px 6px;border-bottom:1px solid var(--line)}
td{padding:4px 6px;border-bottom:1px solid #161e2a}
.grn{color:var(--grn)} .red{color:var(--red)} .yel{color:var(--yel)} .dim{color:var(--dim)}
.win{color:var(--grn)} .stop{color:var(--red)} .hissell{color:var(--yel)} .void{color:var(--dim)} .open{color:var(--blu)}
.ev{display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px dashed #1a2330;font-size:12px}
.engine{display:flex;align-items:center;gap:8px;margin-bottom:8px}
</style></head><body>
<h1>MEGAPHONE <b>OPS</b> &nbsp;·&nbsp; <span id="ts"></span></h1>
<div class="grid">
  <div class="card">
    <h2>🐋 Copy Engine <span id="copy-status"></span></h2>
    <div id="copy-body"></div>
    <table id="copy-trades"></table>
  </div>
  <div class="card">
    <h2>🎯 Dev-Sniper <span id="dev-status"></span></h2>
    <div id="dev-body"></div>
    <table id="dev-trades"></table>
  </div>
</div>
<div class="grid">
  <div class="card"><h2>🛰 Dev Watchlist (top 10)</h2><table id="devs"></table></div>
  <div class="card"><h2>📢 Your Callouts <span id="callout-count" class="dim"></span></h2><table id="callouts"></table></div>
</div>
<div class="grid">
  <div class="card"><h2>📡 Recent Events</h2><div id="events"></div></div>
  <div class="card"><h2>🧹 (reserved)</h2><div class="dim">more panels coming</div></div>
</div>
<div class="card" style="margin-bottom:12px"><h2>💡 IDEAS / PROJECTS</h2><table id="ideas"></table></div>
<script>
const $=id=>document.getElementById(id);
const cls={WIN:'win',STOP:'stop',HISSELL:'hissell',VOID:'void',OPEN:'open'};
async function tick(){
  try{
    const s=await (await fetch('/api/state')).json();
    $('ts').textContent=s.ts;
    // copy
    const c=s.engines.copy;
    $('copy-status').innerHTML=`<span class="dot" style="background:${c.alive?'var(--grn)':'var(--red)'}"></span>${c.alive?'ALIVE':'DOWN'}`;
    $('copy-body').innerHTML=`<div class="kv"><span>target</span><span class="v dim">${c.wallet.slice(0,6)}…${c.wallet.slice(-4)}</span></div>`
      +`<div class="kv"><span>book</span><span class="v">${c.book.n} trades · ${c.book.open} OPEN · ${c.book.win} WIN · ${c.book.stop} STOP · ${c.book.void} VOID</span></div>`
      +`<div class="kv"><span>net PnL</span><span class="v ${c.book.net_pnl_pct>=0?'grn':'red'}">${c.book.net_pnl_pct>0?'+':''}${c.book.net_pnl_pct}%</span></div>`;
    $('copy-trades').innerHTML=rows(c.trades);
    // dev
    const d=s.engines.dev;
    $('dev-status').innerHTML=`<span class="dot" style="background:${d.alive?'var(--grn)':'var(--red)'}"></span>${d.alive?'ALIVE':'DOWN'}`;
    $('dev-body').innerHTML=`<div class="kv"><span>watching</span><span class="v">${d.devs} known-good devs</span></div>`
      +`<div class="kv"><span>book</span><span class="v">${d.book.n} trades · ${d.book.open} OPEN · ${d.book.win} WIN · ${d.book.stop} STOP</span></div>`
      +`<div class="kv"><span>net PnL</span><span class="v ${d.book.net_pnl_pct>=0?'grn':'red'}">${d.book.net_pnl_pct>0?'+':''}${d.book.net_pnl_pct}%</span></div>`;
    $('dev-trades').innerHTML=rows(d.trades);
    // devs list
    $('devs').innerHTML='<tr><th>wallet</th><th>open</th><th>ratio</th></tr>'+d.devs.map(x=>
      `<tr><td>${x.wallet.slice(0,8)}…</td><td>${x.open}/${x.created}</td><td class="grn">${(x.open_ratio*100).toFixed(1)}%</td></tr>`).join('');
    // events
    $('events').innerHTML=s.events.map(e=>{
      const t=new Date(e.t).toTimeString().slice(0,8);
      return `<div class="ev"><span class="dim">${t}</span><span>${e.kind} ${e.mint} <span class="${cls[e.outcome]||'dim'}">${e.outcome}</span></span><span class="${e.pnl>=0?'grn':'red'}">${e.pnl!=null?(e.pnl>0?'+':'')+e.pnl+'%':''}</span></div>`;
    }).join('')||'<div class="dim">no events yet</div>';
    // ideas
    $('ideas').innerHTML='<tr><th>project</th><th>status</th><th>note</th><th>owner</th></tr>'+s.ideas.map(x=>
      `<tr><td><b>${x.name}</b></td><td>${x.status}</td><td class="dim">${x.desc}</td><td>${x.owner}</td></tr>`).join('');
    // callouts
    const co=s.callouts;
    $('callout-count').textContent=`(${co.total} total · ${co.active} active · best ${co.best}x · ${co.totalViews} views)`;
    $('callouts').innerHTML='<tr><th>coin</th><th>mc</th><th>now</th><th>peak</th><th>👁</th><th>thesis</th></tr>'+(co.rows||[]).map(r=>{
      const x=parseFloat(r.x)||1; const pk=parseFloat(r.peak)||1;
      return `<tr><td><b>${r.symbol}</b></td><td>$${(r.mc||0).toLocaleString()}</td><td class="${x>=1?'grn':'red'}">${x.toFixed(2)}x</td><td class="${pk>=1?'grn':'red'}">${pk.toFixed(2)}x</td><td class="dim">${r.views||0}</td><td class="dim">${r.thesis}</td></tr>`;
    }).join('')||'<div class="dim">no callouts yet</div>';
  }catch(e){$('ts').textContent='ERR '+e.message}
}
function rows(ts){
  if(!ts||!ts.length)return '<div class="dim" style="padding:6px 0">no trades yet</div>';
  return '<tr><th>mint</th><th>out</th><th>pnl</th></tr>'+ts.map(t=>
    `<tr><td>${(t.mint||'?').slice(0,8)}</td><td class="${cls[t.outcome]||'dim'}">${t.outcome||'?'}</td><td class="${t.pnlPct>=0?'grn':'red'}">${t.pnlPct!=null?(t.pnlPct>0?'+':'')+t.pnlPct+'%':''}</td></tr>`).join('');
}
tick();setInterval(tick,5000);
</script></body></html>"""

@app.get("/", response_class=HTMLResponse)
def index():
    return HTML
