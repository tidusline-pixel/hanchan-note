/* ===== 計算のしくみ（画面と切り離してテストできるようにしてある） ===== */
const RULE_PRESETS = {
  m4: {label:"四麻（25000持ち30000返し・ウマ10-30）", mode:4, start:25000, ret:30000, uma:[30,10,-10,-30], rate:50, chipRate:0, fee:0},
  m4b:{label:"四麻（25000持ち25000返し・ウマ5-10）", mode:4, start:25000, ret:25000, uma:[10,5,-5,-10], rate:50, chipRate:0, fee:0},
  m3: {label:"三麻（35000持ち40000返し・ウマなし）", mode:3, start:35000, ret:40000, uma:[0,0,0], rate:50, chipRate:100, fee:0},
  m3u:{label:"三麻（35000持ち40000返し・ウマ15）", mode:3, start:35000, ret:40000, uma:[15,0,-15], rate:50, chipRate:100, fee:0},
};
const round1 = x => Math.round(x*10)/10;

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

// セッションの集計：ポイント合計・チップ・その他の項目・場代・円
// net＝人の間でやり取りする額（場代を含まない）、yen＝収支（net−場代）
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

if(typeof module!=="undefined") module.exports={scoreGame,roundKeepTotal,extraGap,chipGap,sessionTotals,settle,filterSessions,playerStats,toCSV,RULE_PRESETS,isValidCode,makeCode,isBackup};
