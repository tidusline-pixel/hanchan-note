/* ===== 計算のしくみ（画面と切り離してテストできるようにしてある） ===== */
const RULE_PRESETS = {
  m4f:{label:"四麻A（25000持ち30000返し・ウマ10-30）", note:"着順の差が大きいルール。1着を取ると大きく増える", mode:4, start:25000, ret:30000, uma:[30,10,-10,-30], rate:50, chipRate:100, fee:0, tie:"seat", tobi:0, round:"56"},
  m4g:{label:"四麻B（25000持ち30000返し・ウマ5-10）", note:"着順の差が小さいルール。素の点数の差が効きやすい", mode:4, start:25000, ret:30000, uma:[10,5,-5,-10], rate:50, chipRate:100, fee:0, tie:"seat", tobi:0, round:"56"},
  m3f:{label:"三麻A（35000持ち40000返し・ウマ20・トビ賞10）", note:"三人打ち。2着は増減なしで、1着と3着に大きく差がつく", mode:3, start:35000, ret:40000, uma:[20,0,-20], rate:50, chipRate:200, fee:0, tie:"seat", tobi:10},
  m4: {label:"四麻（25000持ち30000返し・ウマ10-30）", mode:4, start:25000, ret:30000, uma:[30,10,-10,-30], rate:50, chipRate:0, fee:0},
  m4b:{label:"四麻（25000持ち25000返し・ウマ5-10）", mode:4, start:25000, ret:25000, uma:[10,5,-5,-10], rate:50, chipRate:0, fee:0},
  m3: {label:"三麻（35000持ち40000返し・ウマなし）", mode:3, start:35000, ret:40000, uma:[0,0,0], rate:50, chipRate:100, fee:0},
  m3u:{label:"三麻（35000持ち40000返し・ウマ15）", mode:3, start:35000, ret:40000, uma:[15,0,-15], rate:50, chipRate:100, fee:0},
};
const round1 = x => Math.round(x*10)/10;
// チップ1枚の既定：千点50Pなら四麻100P・三麻200P、千点100Pなら500P
function chipFor(mode,rate){ const r=Number(rate); return r===100?500:Math.round(r*(mode===3?4:2)); }

// 1半荘の結果：scores = {pid: 点数}。席順 order は同点のとき上家を上にするか、ウマを分けるかに使う
// 端数の扱い。"56" は五捨六入（32500→32000、32600→33000）、"45" は四捨五入、空はそのまま。箱下は絶対値で丸める
function roundScore(s,how){
  if(how!=="56"&&how!=="45") return s;
  return Math.sign(s)*Math.floor((Math.abs(s)+(how==="56"?400:500))/1000)*1000;
}
// 同じ点数の人の組。記録のときに上の人を選んでもらう
function tieGroups(scores){
  const by={}; Object.entries(scores).forEach(([id,v])=>(by[v]=by[v]||[]).push(id));
  return Object.values(by).filter(x=>x.length>1);
}
// tobiBy は人を飛ばした人。0点以下の人が1人ごとにトビ賞を払い、tobiBy が受ける。ダブルなら2人分
// rule.tobiDouble は2人以上飛んだときの形。half は1人分を飛んだ人で分ける、low は1人分を一番低い人が払う
function scoreGame(scores, rule, order, tobiBy){
  const ids = Object.keys(scores);
  const n = ids.length;
  const total = ids.reduce((s,id)=>s+Number(scores[id]||0),0);
  // rule.direct はポイントをそのまま入れる形。合計は0で、ウマ・オカは足さない
  const direct = !!rule.direct;
  const expected = direct ? 0 : rule.start*n;
  const sorted = ids.slice().sort((a,b)=> (scores[b]-scores[a]) || ((order||ids).indexOf(a)-(order||ids).indexOf(b)));
  const oka = direct ? 0 : (rule.ret-rule.start)*n/1000;
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
      res[id]={rank, best, worst, point: round1(direct ? scores[id]/1000 : (roundScore(scores[id],rule.round)-rule.ret)/1000 + umaPart + okaPart)};
    }
    i=j+1;
  }
  // 丸めると合計が0からずれるので、1着が残りを受ける
  if(!direct&&rule.round&&total===expected) res[sorted[0]].point=round1(-sorted.slice(1).reduce((a,id)=>a+res[id].point,0));
  const tobi=Number(rule.tobi||0);
  if(!direct&&tobi&&tobiBy&&res[tobiBy]){
    const flown=ids.filter(id=>id!==tobiBy&&scores[id]<=0), how=flown.length>1?rule.tobiDouble:"", low=Math.min(...flown.map(id=>scores[id]));
    const payers=how==="low"?flown.filter(id=>scores[id]===low):flown, pay=round1(how?tobi/payers.length:tobi);
    payers.forEach(id=>{ res[id].point=round1(res[id].point-pay); res[tobiBy].point=round1(res[tobiBy].point+pay); });
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
// ウマを読む。四麻は 5-10 か 5,10 で 10,5,-5,-10 に、三麻は 20 で 20,0,-20 にする。順に全部書いてもよい。読めない・合計が0でないときは null
function parseUma(v,mode){
  const s=String(v??"").replace(/[０-９．]/g,c=>String.fromCharCode(c.charCodeAt(0)-0xFEE0)).trim();
  const m=s.match(/^(\d+\.?\d*)[-−ー~〜](\d+\.?\d*)$/);
  const x=(m?[m[1],m[2]]:s.split(/[,、\s\/]+/).filter(Boolean)).map(parseSigned);
  if(!x.length||x.includes(null)) return null;
  let u=null;
  if(x.length===mode) u=x;
  else if(x.length===1&&x[0]>=0) u=mode===3?[x[0],0,-x[0]]:[x[0]*2,x[0],-x[0],-x[0]*2];
  else if(mode===4&&x.length===2&&x[0]>=0&&x[1]>=0){ const a=Math.min(...x), b=Math.max(...x); u=[b,a,-a,-b]; }
  if(!u||u.reduce((a,b)=>a+b,0)!==0) return null;
  return u.map(n=>n===0?0:n);
}
const umaHelp=mode=>mode===4?"ウマは 5-10、5,10、10,5,-5,-10 のどれかの形で入れてください（合計は0）":"ウマは 20 か 20,0,-20 の形で入れてください（合計は0）";
// 拡張の試用。1回だけで、コードを入れたことがある人には出さない。終わり方は期限つきのコードと同じ
const TRIAL_DAYS=30;
const canTrial=s=>!s.unlocked&&!s.trialUsed;
function startTrial(s,now){ if(!canTrial(s)) return false; Object.assign(s,{unlocked:true,unlockUntil:now+TRIAL_DAYS*864e5,trial:true,trialUsed:true}); return true; }
// 見本が残っているか。見本の回に半荘を足した人の分は本人の記録として残す
function hasSample(d){ return (d.sessions||[]).some(s=>s.sample)||(d.players||[]).some(p=>p.sample); }
function clearSample(d){
  d.sessions=d.sessions.filter(s=>{ if(!s.sample) return true; if(s.games.length>(s.sampleN||3)){ delete s.sample; return true; } return false; });
  const used=new Set(d.sessions.flatMap(s=>s.members));
  d.players=d.players.filter(p=>{ if(!p.sample) return true; if(used.has(p.id)){ delete p.sample; return true; } return false; });
  const alive=id=>d.players.some(p=>p.id===id);
  if(d.settings.me&&!alive(d.settings.me)) d.settings.me="";
  if(d.settings.lastMembers) d.settings.lastMembers=d.settings.lastMembers.filter(alive);
  d.sample=false;
  return d;
}

// セットの中の人を入れ替える。点数・チップ・その他の項目はそのまま引き継ぐ。入れ替える先がもう参加していたらしない
function swapPlayer(s,from,to){
  if(!s.members.includes(from)||s.members.includes(to)) return false;
  const rekey=o=>o&&Object.fromEntries(Object.entries(o).map(([k,v])=>[k===from?to:k,v]));
  s.members=s.members.map(id=>id===from?to:id);
  (s.games||[]).forEach(g=>{ g.scores=rekey(g.scores); if(g.chips) g.chips=rekey(g.chips); if(g.order) g.order=g.order.map(id=>id===from?to:id); if(g.tobiBy===from) g.tobiBy=to; });
  if(s.chips) s.chips=rekey(s.chips);
  if(s.chipBase) s.chipBase=rekey(s.chipBase);
  (s.extras||[]).forEach(x=>{ if(x.counts) x.counts=rekey(x.counts); });
  return true;
}
// 半荘ごとのチップ。合計は s.chips のまま持ち、始める前の枚数は chipBase に残して足す
function syncGameChips(s){
  if(!s.chipByGame) return;
  s.chips=Object.fromEntries(s.members.map(id=>[id,round1((s.games||[]).reduce((a,g)=>a+Number((g.chips||{})[id]||0),Number((s.chipBase||{})[id]||0)))]));
}
function startGameChips(s){ s.chipByGame=true; s.chipBase={...(s.chips||{})}; syncGameChips(s); }
function stopGameChips(s){ syncGameChips(s); delete s.chipByGame; delete s.chipBase; (s.games||[]).forEach(g=>{ delete g.chips; }); }
// 別の端末の記録を足す。同じ人は名前で見分ける。同じ回は id か中身で見分け、二重に入れない
// 同じ id の回は半荘が多い方を残す。フリーは端末の持ち主の成績なので opt.free のときだけ足す
function mergeBackup(d,o,opt={}){
  const out={sets:0,updated:0,same:0,players:0,free:0,rules:0}, map={}, taken=new Set();
  const theirs=(o.sessions||[]).filter(s=>!s.sample), used=new Set(theirs.flatMap(s=>s.members));
  (o.players||[]).filter(p=>used.has(p.id)&&d.players.some(x=>x.id===p.id)).forEach(p=>{ map[p.id]=p.id; taken.add(p.id); });
  (o.players||[]).filter(p=>used.has(p.id)&&!map[p.id]).forEach(p=>{
    if(p.guest){ ensureGuest(d,p.id); map[p.id]=p.id; return; }
    const same=d.players.find(x=>!x.guest&&!x.sample&&!taken.has(x.id)&&x.name===p.name);
    if(same){ map[p.id]=same.id; taken.add(same.id); return; }
    const{sample,...copy}=p; d.players.push(copy); map[p.id]=p.id; taken.add(p.id); out.players++;
  });
  const to=id=>map[id]||id, rekey=x=>x&&Object.fromEntries(Object.entries(x).map(([k,v])=>[to(k),v]));
  const mapped=x=>{ const s=JSON.parse(JSON.stringify(x));
    s.members=s.members.map(to); s.chips=rekey(s.chips)||{}; if(s.chipBase) s.chipBase=rekey(s.chipBase);
    s.games.forEach(g=>{ g.scores=rekey(g.scores); if(g.chips) g.chips=rekey(g.chips); if(g.order) g.order=g.order.map(to); if(g.tobiBy) g.tobiBy=to(g.tobiBy); });
    (s.extras||[]).forEach(e=>{ e.counts=rekey(e.counts)||{}; });
    return s; };
  const key=s=>`${s.date}|${s.members.slice().sort()}|${s.games.map(g=>JSON.stringify(Object.entries(g.scores).sort()))}`;
  const seen=new Set(d.sessions.map(key));
  theirs.forEach(x=>{ const s=mapped(x), i=d.sessions.findIndex(y=>y.id===s.id);
    if(i>=0){ if(s.games.length>d.sessions[i].games.length){ d.sessions[i]=s; out.updated++; } else out.same++; return; }
    if(seen.has(key(s))){ out.same++; return; }
    d.sessions.push(s); seen.add(key(s)); out.sets++; });
  if(opt.free&&o.free&&d.free) (o.free.games||[]).forEach(g=>{ if(!d.free.games.some(x=>x.id===g.id)){ d.free.games.push(JSON.parse(JSON.stringify(g))); out.free++; } });
  d.rules=d.rules||[];
  (o.rules||[]).forEach(r=>{ if(!d.rules.some(x=>x.name===r.name)){ d.rules.push(JSON.parse(JSON.stringify(r))); out.rules++; } });
  return out;
}
// ゲストや二重に作った人の記録を全部まとめる。同じ回に2人ともいる回は動かせないので残し、その数を返す
function mergePlayer(d,from,to){
  let moved=0, skipped=0;
  d.sessions.filter(s=>s.members.includes(from)).forEach(s=>{ if(swapPlayer(s,from,to)) moved++; else skipped++; });
  if(skipped) return {moved,skipped};
  d.players=d.players.filter(p=>p.id!==from);
  if(d.settings.me===from) d.settings.me=to;
  const map=x=>[...new Set(x.map(id=>id===from?to:id))];
  if(d.settings.lastMembers) d.settings.lastMembers=map(d.settings.lastMembers);
  (d.saved||[]).forEach(sv=>{ if(sv.filter&&sv.filter.members) sv.filter.members=map(sv.filter.members); });
  return {moved,skipped};
}

// 点数を読む。200以下は千点単位（30→30000、32.5→32500、5-→-5000）、それより大きければそのまま
// 点数の入力単位。四麻は100点棒があるので 300 で 30000点、三麻は 30 で 30000点。ポイントで入れる形は数のまま
const scoreUnit=r=>r&&r.mode===4&&!r.direct?100:1000;
function parseScore(v,unit=1000){
  const n=parseSigned(v);
  if(n===null) return null;
  return Math.round(Math.abs(n)<=(unit===100?999:200) ? n*unit : n);
}

// フリーの1半荘：自分の点数と着順だけで出す。ゲーム代は負け分と同じく引く。feeTop はトップだけ違う店のため
// r.tobi はトビ賞。0点以下で払い、tobiWin（人を飛ばした）でもらう
function freeResult(score, rank, chips, r, tobiWin){
  const oka=(r.ret-r.start)*r.mode/1000, tobi=Number(r.tobi||0);
  const point=round1((roundScore(score,r.round)-r.ret)/1000 + (r.uma[rank-1]||0) + (rank===1?oka:0) - (score<=0?tobi:0) + (tobiWin?tobi:0));
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
// 起こらない着順と点数の組み合わせ。2着の点数の2倍が全員の合計を超える、1着が持ち点より下、など
const impossibleScore=(score,rank,r)=>score*rank>r.start*r.mode || (rank===1&&score<r.start);
function quickTable(r){
  return QUICK_SCORES.map(k=>{ const score=k*1000;
    return {score, cells:Array.from({length:r.mode},(_,i)=>{ const rank=i+1;
      if(impossibleScore(score,rank,r)) return null;
      return freeResult(score,rank,0,r).total; })}; });
}

// バックアップの中身のまとめ。戻す前後で見比べ、code が同じなら記録は1文字も違わない
function backupSummary(d){
  const sets=d.sessions||[], free=(d.free&&d.free.games)||[], dates=[...sets.map(s=>s.date),...free.map(g=>g.date)].sort();
  return {sets:sets.length, setGames:sets.reduce((a,s)=>a+s.games.length,0), freeGames:free.length, players:(d.players||[]).length, rules:(d.rules||[]).length, last:dates[dates.length-1]||"",
    code:fnv1a(JSON.stringify([d.players||[],sets,free,d.rules||[]])).toString(36).toUpperCase()};
}

// 無料で登録できるメンバーの数。見本の人は数えない。上限を超えたデータ（バックアップから戻した分など）も使えて、止めるのは追加だけ
const FREE_PLAYERS=5;
function canAddPlayer(d){ return isUnlocked(d.settings) || (d.players||[]).filter(p=>!p.sample&&!p.guest).length<FREE_PLAYERS; }
// 1回だけの人。使ったときだけ登録し、上限には数えない。同じゲストは別の日でも同じ1人になる
const GUESTS=["guest1","guest2","guest3"];
function ensureGuest(d,id){ if(GUESTS.includes(id)&&!d.players.some(p=>p.id===id)) d.players.push({id,name:"ゲスト"+id.slice(5),color:"#8a8f8a",guest:true}); }

// メンバーを最近打った順に並べる。前回のメンバーを先頭に、一度も打っていない人は登録順で最後に
function playersByRecent(d){
  const ss=(d.sessions||[]).slice().reverse().sort((a,b)=>b.date.localeCompare(a.date));
  const ids=[...new Set([...((d.settings&&d.settings.lastMembers)||[]),...ss.flatMap(s=>s.members)])];
  const by=id=>(d.players||[]).find(p=>p.id===id);
  return [...ids.map(by).filter(Boolean),...(d.players||[]).filter(p=>!ids.includes(p.id))];
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
// 場代の分け方。equal は割り勘、win は勝ち額に応じて、top は収支が一番の人が全部払う
// win は勝った人の順番が変わらない。場代が勝ち額の合計より多いときは、足りない分を割り勘にする
function venueShares(nets,amount,how){
  const ids=Object.keys(nets), n=ids.length, a=Number(amount||0);
  if(!n||!a) return Object.fromEntries(ids.map(id=>[id,0]));
  const W=ids.reduce((x,id)=>x+Math.max(nets[id],0),0);
  if(how==="top"){ const top=ids.reduce((b,id)=>nets[id]>nets[b]?id:b,ids[0]); return Object.fromEntries(ids.map(id=>[id,id===top?a:0])); }
  if(how==="win"&&W>0) return roundKeepTotal(Object.fromEntries(ids.map(id=>{const w=Math.max(nets[id],0); return [id,a<=W?w*a/W:w+(a-W)/n];})));
  return roundKeepTotal(Object.fromEntries(ids.map(id=>[id,a/n])));
}
// 場代を引いたあとに、収支の順番が入れ替わるか
function venueFlips(t){
  const ids=Object.keys(t);
  return ids.some(a=>ids.some(b=>t[a].net>t[b].net&&t[a].yen<t[b].yen));
}
function sessionTotals(s){
  const t = {};
  s.members.forEach(id=>t[id]={point:0, games:0, ranks:[], spans:[], chips:Number((s.chips||{})[id]||0), extra:extraOf(s,id), fee:Number(s.rule.fee||0), net:0, yen:0});
  (s.games||[]).forEach(g=>{
    const r = scoreGame(g.scores, s.rule, g.order||s.members, g.tobiBy);
    Object.entries(r.res).forEach(([id,v])=>{ if(!t[id])return; t[id].point=round1(t[id].point+v.point); t[id].games++; t[id].ranks.push(v.rank); t[id].spans.push({best:v.best,worst:v.worst,n:s.rule.mode}); });
  });
  const net = roundKeepTotal(Object.fromEntries(Object.entries(t).map(([id,v])=>[id, v.point*s.rule.rate + v.chips*s.rule.chipRate + v.extra])));
  const venue=s.venue||{}, vs=venueShares(net,venue.amount,venue.how);
  Object.entries(t).forEach(([id,v])=>{ v.net=net[id]; v.fee+=vs[id]; v.yen=v.net-v.fee; });
  return t;
}

// LINE などへ貼る精算の文。name は id から名前を返す関数
function settleText(s,name){
  const t=sessionTotals(s), [,m,d]=s.date.split("-").map(Number), p=v=>v.toLocaleString("ja-JP")+"P";
  const lines=[`${m}/${d} 半荘ノート`,...s.members.slice().sort((a,b)=>t[b].yen-t[a].yen).map(id=>`${name(id)} ${t[id].yen===0?"±0P":(t[id].yen>0?"+":"−")+p(Math.abs(t[id].yen))}`)];
  lines.push(...settle(Object.fromEntries(s.members.map(id=>[id,t[id].net]))).map(x=>`${name(x.from)} → ${name(x.to)} ${p(x.yen)}`));
  if(s.members.some(id=>t[id].fee)) lines.push("※場代は収支から引いてあり、やり取りには入れていません");
  return lines.join("\n");
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

// 着順ごとの回数。同着は分け合う
function rankDist(spans,n){ return Array.from({length:n},(_,k)=>spans.reduce((a,r)=>a+(k+1>=r.best&&k+1<=r.worst?1/(r.worst-r.best+1):0),0)); }
// 4人で回す三麻。その半荘に点数がない人が抜けた人
const outOf=(s,g)=>s.members.find(id=>!(id in g.scores))||null;
// 次に抜ける人。前の半荘で抜けた人の次の人で、違うときは画面で選び直す
function nextOut(s){
  if(s.members.length<=s.rule.mode) return null;
  const g=s.games[s.games.length-1]; if(!g) return s.members[s.members.length-1];
  return s.members[(s.members.indexOf(outOf(s,g))+1)%s.members.length];
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
    p.dist = rankDist(p.spans,n);
  });
  return st;
}

function toCSV(rows){ return rows.map(r=>r.map(c=>{const s=String(c??""); return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(",")).join("\r\n"); }

/* ===== 解放コード：HN2＋中身7バイトと署名64バイト。秘密鍵は手元の tools/ にだけあり、ここには確かめる鍵しかない
   中身は 版1・期限2（2026-01-01 からの日数、0 は期限なし）・番号4。作り方は tools/make_codes.js ===== */
const CODE_PUB="BDNb6MxF1tA4n_4-hTgDnN9Kc53jmGOvr4i11bdMsnvCaf9Y9rpzhRy3LRYV4B7-v8Qrjn5wSx7JMHUa35vFFd4", CODE_EPOCH=Date.UTC(2026,0,1);
const b64u=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")),c=>c.charCodeAt(0));
async function verifyCode(code,pub=CODE_PUB,now=Date.now()){
  const m=/^HN2([A-Za-z0-9_-]{95})$/.exec(String(code||"").replace(/\s/g,""));
  if(!m) return {ok:false};
  try{
    const b=b64u(m[1]), body=b.slice(0,7), key=await crypto.subtle.importKey("raw",b64u(pub),{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
    if(body[0]!==2 || !await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},key,b.slice(7),body)) return {ok:false};
    const days=body[1]*256+body[2], until=days?CODE_EPOCH+days*864e5:0;
    return until&&now>=until?{ok:false,expired:true,until}:{ok:true,until};
  }catch(e){ return {ok:false}; }
}
// 解放の状態。期限つきのコードは期限が過ぎると閉じる。記録はそのまま残る
const isUnlocked=(s,now=Date.now())=>!!(s&&s.unlocked)&&(!s.unlockUntil||now<s.unlockUntil);
function fnv1a(s){ let h=0x811c9dc5; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; } return h; }

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

if(typeof module!=="undefined") module.exports={mergeBackup,syncGameChips,startGameChips,stopGameChips,settleText,rankDist,outOf,nextOut,TRIAL_DAYS,canTrial,startTrial,swapPlayer,mergePlayer,parseUma,umaHelp,hasSample,clearSample,parseSigned,parseScore,freeResult,scoreGame,roundKeepTotal,extraGap,chipGap,sessionTotals,settle,filterSessions,playerStats,toCSV,RULE_PRESETS,verifyCode,isUnlocked,CODE_EPOCH,isBackup,gameCount,nextSnaps,unsavedGames,backupDue,ruleNote,tieGroups,venueShares,venueFlips,impossibleScore,scoreUnit,roundScore,playersByRecent,FREE_PLAYERS,canAddPlayer,GUESTS,ensureGuest,freeSummary,freeDays,filterFree,chipFor,quickTable,backupSummary,logEntries,logTotals,dayMap,monthGrid,shiftMonth};
