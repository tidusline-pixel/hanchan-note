/* ===== 計算のしくみ（画面と切り離してテストできるようにしてある） ===== */
const RULE_PRESETS = {
  m4f:{label:"四麻A（25000持ち30000返し・ウマ10-30）", note:"着順の差が大きいルール。1着を取ると大きく増える", mode:4, start:25000, ret:30000, uma:[30,10,-10,-30], rate:50, chipRate:100, fee:0, tie:"seat", tobi:0},
  m4g:{label:"四麻B（25000持ち30000返し・ウマ5-10）", note:"着順の差が小さいルール。素の点数の差が効きやすい", mode:4, start:25000, ret:30000, uma:[10,5,-5,-10], rate:50, chipRate:100, fee:0, tie:"seat", tobi:0},
  m3f:{label:"三麻C（35000持ち40000返し・ウマ20・トビ賞10）", note:"三人打ち。2着は増減なしで、1着と3着に大きく差がつく", mode:3, start:35000, ret:40000, uma:[20,0,-20], rate:50, chipRate:200, fee:0, tie:"seat", tobi:10},
  m4: {label:"四麻（25000持ち30000返し・ウマ10-30）", mode:4, start:25000, ret:30000, uma:[30,10,-10,-30], rate:50, chipRate:0, fee:0},
  m4b:{label:"四麻（25000持ち25000返し・ウマ5-10）", mode:4, start:25000, ret:25000, uma:[10,5,-5,-10], rate:50, chipRate:0, fee:0},
  m3: {label:"三麻（35000持ち40000返し・ウマなし）", mode:3, start:35000, ret:40000, uma:[0,0,0], rate:50, chipRate:100, fee:0},
  m3u:{label:"三麻（35000持ち40000返し・ウマ15）", mode:3, start:35000, ret:40000, uma:[15,0,-15], rate:50, chipRate:100, fee:0},
};
const round1 = x => Math.round(x*10)/10;
// チップ1枚の既定：千点50Pなら四麻100P・三麻200P、千点100Pなら500P
function chipFor(mode,rate){ const r=Number(rate); return r===100?500:Math.round(r*(mode===3?4:2)); }

// 1半荘の結果：scores = {pid: 点数}。席順 order は同点のとき上家を上にするか、ウマを分けるかに使う
function scoreGame(scores, rule, order){
  const ids = Object.keys(scores);
  const n = ids.length;
  const total = ids.reduce((s,id)=>s+Number(scores[id]||0),0);
  const expected = rule.start*n;
  const sorted = ids.slice().sort((a,b)=> (scores[b]-scores[a]) || ((order||ids).indexOf(a)-(order||ids).indexOf(b)));
  const oka = (rule.ret-rule.start)*n/1000;
  const res = {};
  let i=0;
  while(i<n){
    let j=i; while(j+1<n && scores[sorted[j+1]]===scores[sorted[i]]) j++;
    const tie = rule.tie || "split";
    for(let k=i;k<=j;k++){
      const id = sorted[k];
      let umaPart, okaPart, rank, best, worst;
      if(tie==="split"){
        let u=0,o=0; for(let m=i;m<=j;m++){u+=rule.uma[m]||0; if(m===0)o+=oka;}
        umaPart=u/(j-i+1); okaPart=o/(j-i+1); rank=(i+j)/2+1; best=i+1; worst=j+1;
      }else{ umaPart=rule.uma[k]||0; okaPart=k===0?oka:0; rank=k+1; best=worst=k+1; }
      res[id]={rank, best, worst, point: round1((scores[id]-rule.ret)/1000 + umaPart + okaPart)};
    }
    i=j+1;
  }
  return {res, total, expected, ok: total===expected};
}

// 円に丸める。人ごとに丸めると合計が1円ずれるので、ずれた分は一番多い人（足りないときは一番少ない人）で合わせる
function roundKeepTotal(rawById){
  const clean = Object.entries(rawById).map(([id,v])=>[id,Math.round(v*1e6)/1e6]);
  const out = Object.fromEntries(clean.map(([id,v])=>[id,Math.round(v)]));
  const target = Math.round(clean.reduce((s,[,v])=>s+v,0));
  let diff = Object.values(out).reduce((a,b)=>a+b,0) - target;
  const order = clean.slice().sort((a,b)=>b[1]-a[1]).map(([id])=>id);
  for(let i=0; diff!==0 && order.length; i++){
    if(diff>0){ out[order[i%order.length]]--; diff--; }
    else{ out[order[order.length-1-i%order.length]]++; diff++; }
  }
  return out;
}

// その他の項目（1人分の増減）：祝儀・トビ賞など。金額×その人の回数
function extraOf(s,id){
  return (s.extras||[]).reduce((sum,x)=>sum+Number(x.price||0)*Number((x.counts||{})[id]||0),0);
}
// 項目ごとの回数の合計。0でなければ、受け取る相手のいない分がある
function extraGap(x){ return Object.values(x.counts||{}).reduce((a,b)=>a+Number(b||0),0); }
function chipGap(s){ return s.members.reduce((a,id)=>a+Number((s.chips||{})[id]||0),0); }

// 手入力の数字を読む。スマホの数字キーに「-」が無いので 5- も ▲5 もマイナスとして読む
function parseSigned(v){
  const s=String(v??"").replace(/[０-９．]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).replace(/[,，\s]/g,"");
  const m=s.match(/^([-−ー▲△]?)(\d+\.?\d*|\.\d+)([-−ー▲△]?)$/);
  if(!m) return null;
  const n=Number(m[2]);
  return (m[1]||m[3]) && n!==0 ? -n : n;
}
// 点数を読む。200以下は千点単位（30→30000、32.5→32500、5-→-5000）、それより大きければそのまま
function parseScore(v){
  const n=parseSigned(v);
  if(n===null) return null;
  return Math.round(Math.abs(n)<=200 ? n*1000 : n);
}

// フリーの1半荘：自分の点数と着順だけで出す。ゲーム代は負け分と同じく引く。feeTop はトップだけ違う店のため
// r.tobi はトビ賞。0点以下で払い、tobiWin（人を飛ばした）でもらう
function freeResult(score, rank, chips, r, tobiWin){
  const oka=(r.ret-r.start)*r.mode/1000, tobi=Number(r.tobi||0);
  const point=round1((score-r.ret)/1000 + (r.uma[rank-1]||0) + (rank===1?oka:0) - (score<=0?tobi:0) + (tobiWin?tobi:0));
  const fee=Number(rank===1 && r.feeTop!==undefined && r.feeTop!=="" ? r.feeTop : r.fee||0);
  const gain=point*r.rate + Number(chips||0)*r.chipRate;
  return {point, fee, total:Math.round(Math.round(gain*1e6)/1e6 - fee)};
}

// フリーの半荘をまとめる。ラスは半荘ごとのルールの人数で見る
function freeSummary(games){
  const x=games.map(g=>freeResult(g.score,g.rank,g.chips,g.rule,g.tobiWin)), n=games.length||1;
  return {games:games.length, point:round1(x.reduce((a,v)=>a+v.point,0)), total:x.reduce((a,v)=>a+v.total,0),
    avgRank:games.length?games.reduce((a,g)=>a+g.rank,0)/n:null,
    top:games.filter(g=>g.rank===1).length/n, lastAvoid:1-games.filter(g=>g.rank===g.rule.mode).length/n};
}
// 日ごとにまとめる。新しい日が先
function freeDays(games){
  return [...new Set(games.map(g=>g.date))].sort().reverse().map(date=>{const items=games.filter(g=>g.date===date); return {date,items,...freeSummary(items)};});
}
// 成績タブの条件のうち、フリーに当てはまるものだけで絞る。場所・面子・手で選んだ回は人の記録なので、フリーは出さない
function filterFree(games, f){
  if((f.tags&&f.tags.length)||(f.members&&f.members.length)||(f.pick&&f.pick.length)) return [];
  return games.filter(g=>(!f.from||g.date>=f.from)&&(!f.to||g.date<=f.to)&&(!f.mode||String(g.rule.mode)===String(f.mode))&&(!(f.rates&&f.rates.length)||f.rates.includes(Number(g.rule.rate))));
}

// ルールの説明：返しちょうどで終わったときの着順ごとの増減。オカは1着に足す
function ruleNote(r){
  const oka=(r.ret-r.start)*r.mode/1000, f=v=>(v>0?"+":v<0?"−":"±")+Math.abs(v);
  return `${r.ret}点で終わったときの増減：${r.uma.map((u,i)=>`${i+1}着 ${f(u+(i===0?oka:0))}`).join("・")}${oka?`（1着はオカ${oka}込み）`:""}`;
}

// 点数の早見表：ルールごとに、点数と着順で結果（チップなし・トビ賞のやり取りは0点以下で払う分だけ・ゲーム代込み）を出す
// 起こらない組み合わせは null。k着の点数は合計÷k を超えず、1着は持ち点を下回らない
const QUICK_SCORES=[60,50,45,40,35,30,25,20,15,10,5,1,0,-5,-10];
function quickTable(r){
  const all=r.start*r.mode;
  return QUICK_SCORES.map(k=>{ const score=k*1000;
    return {score, cells:Array.from({length:r.mode},(_,i)=>{ const rank=i+1;
      if(score*rank>all || (rank===1&&score<r.start)) return null;
      return freeResult(score,rank,0,r).total; })}; });
}

// バックアップの中身のまとめ。戻す前後で見比べ、code が同じなら記録は1文字も違わない
function backupSummary(d){
  const sets=d.sessions||[], free=(d.free&&d.free.games)||[], dates=[...sets.map(s=>s.date),...free.map(g=>g.date)].sort();
  return {sets:sets.length, setGames:sets.reduce((a,s)=>a+s.games.length,0), freeGames:free.length, players:(d.players||[]).length, rules:(d.rules||[]).length, last:dates[dates.length-1]||"",
    code:fnv1a(JSON.stringify([d.players||[],sets,free,d.rules||[]])).toString(36).toUpperCase()};
}

// セッションの一覧：セットの会とフリーの日を1本に並べる。保存の形は変えず、見るときだけ混ぜる
// total は自分の収支。セットで自分が決まっていない、または自分がいない回は null
function logEntries(d){
  const me=d.settings&&d.settings.me;
  const sets=(d.sessions||[]).map(s=>{ const t=sessionTotals(s);
    return {kind:"set",id:s.id,date:s.date,title:s.title||"",place:(s.tags||[]).join(" "),games:(s.games||[]).length,mode:s.rule.mode,rate:s.rule.rate,total:me&&t[me]?t[me].yen:null}; });
  const frees=freeDays((d.free&&d.free.games)||[]).map(x=>({kind:"free",id:"free:"+x.date,date:x.date,title:"",place:"",games:x.games,total:x.total}));
  return [...sets,...frees].sort((a,b)=>b.date.localeCompare(a.date)||a.kind.localeCompare(b.kind));
}
function logTotals(es){
  return {count:es.length, games:es.reduce((a,e)=>a+e.games,0), total:es.reduce((a,e)=>a+(e.total||0),0), unknown:es.filter(e=>e.total===null).length};
}
// カレンダー：日ごとの合計と、その日にある種類
function dayMap(es){
  const m={};
  es.forEach(e=>{ const x=m[e.date]||(m[e.date]={total:0,known:false,kinds:[],entries:[]});
    if(e.total!==null){ x.total+=e.total; x.known=true; }
    if(!x.kinds.includes(e.kind)) x.kinds.push(e.kind);
    x.entries.push(e); });
  return m;
}
// 月の格子。日曜始まりで、先頭の空きは null。ym は "2026-10"
function monthGrid(ym){
  const [y,mo]=ym.split("-").map(Number), blank=new Date(Date.UTC(y,mo-1,1)).getUTCDay(), last=new Date(Date.UTC(y,mo,0)).getUTCDate();
  return [...Array(blank).fill(null),...Array.from({length:last},(_,i)=>`${ym}-${String(i+1).padStart(2,"0")}`)];
}
function shiftMonth(ym,n){ const [y,mo]=ym.split("-").map(Number), d=new Date(Date.UTC(y,mo-1+n,1)); return d.toISOString().slice(0,7); }

// セッションの集計：ポイント合計・チップ・その他の項目・ゲーム代
// net＝人の間でやり取りする額（ゲーム代を含まない）、yen＝収支（net−ゲーム代）
function sessionTotals(s){
  const t = {};
  s.members.forEach(id=>t[id]={point:0, games:0, ranks:[], spans:[], chips:Number((s.chips||{})[id]||0), extra:extraOf(s,id), fee:Number(s.rule.fee||0), net:0, yen:0});
  (s.games||[]).forEach(g=>{
    const r = scoreGame(g.scores, s.rule, s.members);
    Object.entries(r.res).forEach(([id,v])=>{ if(!t[id])return; t[id].point=round1(t[id].point+v.point); t[id].games++; t[id].ranks.push(v.rank); t[id].spans.push({best:v.best,worst:v.worst,n:s.rule.mode}); });
  });
  const net = roundKeepTotal(Object.fromEntries(Object.entries(t).map(([id,v])=>[id, v.point*s.rule.rate + v.chips*s.rule.chipRate + v.extra])));
  Object.entries(t).forEach(([id,v])=>{ v.net=net[id]; v.yen=v.net-v.fee; });
  return t;
}

// 精算：払う回数が少なくなるように、一番負けた人から一番勝った人へ順に払う
function settle(yenById){
  const pos = Object.entries(yenById).filter(([,v])=>v>0).map(([id,v])=>({id,v})).sort((a,b)=>b.v-a.v);
  const neg = Object.entries(yenById).filter(([,v])=>v<0).map(([id,v])=>({id,v:-v})).sort((a,b)=>b.v-a.v);
  const out=[]; let i=0,j=0;
  while(i<neg.length && j<pos.length){
    const x=Math.min(neg[i].v,pos[j].v);
    if(x>0) out.push({from:neg[i].id,to:pos[j].id,yen:x});
    neg[i].v-=x; pos[j].v-=x;
    if(neg[i].v===0)i++; if(pos[j].v===0)j++;
  }
  return out;
}

// 絞り込み：期間・四麻/三麻・レート・場所/タグ・面子・手で選んだセッション
function filterSessions(sessions, f){
  return sessions.filter(s=>{
    if(f.from && s.date < f.from) return false;
    if(f.to && s.date > f.to) return false;
    if(f.mode && String(s.rule.mode)!==String(f.mode)) return false;
    if(f.rates && f.rates.length && !f.rates.includes(Number(s.rule.rate))) return false;
    if(f.tags && f.tags.length && !f.tags.some(t=>(s.tags||[]).includes(t))) return false;
    if(f.members && f.members.length && !f.members.every(id=>s.members.includes(id))) return false;
    if(f.pick && f.pick.length && !f.pick.includes(s.id)) return false;
    return true;
  });
}

// 人ごとの成績。同着はトップ・連対・ラスをその順位に含め、着順の割合は分け合う
function playerStats(sessions, n){
  const st={};
  sessions.slice().sort((a,b)=>a.date.localeCompare(b.date)).forEach(s=>{
    const t=sessionTotals(s);
    Object.entries(t).forEach(([id,v])=>{
      const p = st[id] || (st[id]={games:0,point:0,yen:0,chips:0,ranks:[],spans:[],hist:[]});
      p.games+=v.games; p.point=round1(p.point+v.point); p.yen+=v.yen; p.chips+=v.chips; p.ranks.push(...v.ranks); p.spans.push(...v.spans);
      p.hist.push({date:s.date, yen:p.yen});
    });
  });
  Object.values(st).forEach(p=>{
    const g=p.spans.length||1;
    p.avgRank = p.ranks.length? p.ranks.reduce((a,b)=>a+b,0)/p.ranks.length : null;
    p.top = p.spans.filter(r=>r.best===1).length/g;
    p.rentai = p.spans.filter(r=>r.best<=2).length/g;
    p.lastAvoid = 1 - p.spans.filter(r=>r.worst===r.n).length/g;
    p.dist = Array.from({length:n},(_,k)=>p.spans.reduce((a,r)=>a+(k+1>=r.best&&k+1<=r.worst?1/(r.worst-r.best+1):0),0));
  });
  return st;
}

function toCSV(rows){ return rows.map(r=>r.map(c=>{const s=String(c??""); return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(",")).join("\r\n"); }

/* ===== 解放コード：HN-XXXX-XXXX-CCCC。後ろの4文字が前の8文字から決まる。
   サーバーが無いので漏れる前提の軽い仕組み（作り方は tools/make_codes.js） ===== */
const CODE_SALT="hanchan-note-v1";
function fnv1a(s){ let h=0x811c9dc5; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; } return h; }
function codeCheck(body){ return fnv1a(CODE_SALT+body).toString(36).toUpperCase().padStart(4,"0").slice(-4); }
function normalizeCode(c){ return String(c||"").toUpperCase().replace(/[^0-9A-Z]/g,""); }
function isValidCode(c){ const n=normalizeCode(c); return /^HN[0-9A-Z]{12}$/.test(n) && codeCheck(n.slice(2,10))===n.slice(10); }
function makeCode(body){ const b=normalizeCode(body); return `HN-${b.slice(0,4)}-${b.slice(4,8)}-${codeCheck(b)}`; }

// バックアップの形を確かめる。読み込みで今の記録を壊さないように
function isBackup(d){ return !!d && Array.isArray(d.players) && Array.isArray(d.sessions) && d.sessions.every(s=>s && Array.isArray(s.members) && s.rule && Array.isArray(s.games)); }

function gameCount(d){ return (d.sessions||[]).reduce((a,s)=>a+(s.games||[]).length,0)+((d.free&&d.free.games)||[]).length; }

// 端末の中の自動の控え。新しい順に10個まで、1時間に1個まで。見本や空の記録は取らない
const SNAP_GAP=3600e3, SNAP_KEEP=10;
function nextSnaps(snaps,d,now,force){
  if(d.sample || !gameCount(d)) return snaps;
  const text=JSON.stringify(d), last=snaps[0];
  if(last && (last.text===text || (!force && now-last.at<SNAP_GAP))) return snaps;
  return [{at:now,text},...snaps].slice(0,SNAP_KEEP);
}
// ファイルに保存していない半荘の数
function unsavedGames(d){ return Math.max(0,gameCount(d)-Number(d.settings.backupGames||0)); }
// 保存の声をかけるか：設定の半荘数（既定10、0はかけない）だけ増えたとき。「あとで」を押すとそこから数え直す
const NUDGE_DEFAULT=10;
function backupDue(d){
  const every=d.settings.nudgeEvery??NUDGE_DEFAULT;
  if(d.sample || !every) return false;
  return gameCount(d)-Math.max(Number(d.settings.backupGames||0),Number(d.settings.nudgeSkip||0)) >= every;
}

if(typeof module!=="undefined") module.exports={parseSigned,parseScore,freeResult,scoreGame,roundKeepTotal,extraGap,chipGap,sessionTotals,settle,filterSessions,playerStats,toCSV,RULE_PRESETS,isValidCode,makeCode,isBackup,gameCount,nextSnaps,unsavedGames,backupDue,ruleNote,freeSummary,freeDays,filterFree,chipFor,quickTable,backupSummary,logEntries,logTotals,dayMap,monthGrid,shiftMonth};
