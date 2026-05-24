"use strict";

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG (unchanged from original)
═══════════════════════════════════════════════════════════════════════════ */
const CFG = {
  mqtt: {
    broker:   "wss://broker.hivemq.com:8884/mqtt",
    topic:    "smartcampus/demo1/summary",
    clientId: "sct-" + Math.random().toString(16).slice(2,8),
  },
  room: { W:12, D:9, H:4, doorX:-3.5, doorW:1.6, doorH:2.6, frontZ:4.5 },
  occupancy: { emptyMs: 60_000 },
  thr: {
    temp:  { lo:18, wLo:22, wHi:28, hi:31 },
    hum:   { lo:35, hi:75 },
    gas:   { w:40, hi:60 },
    noise: { w:55, hi:70 },
  },
  alert: {
    cd: { temp:45e3, hum:60e3, gas:30e3, noise:20e3, occupancy:5e3, comfort:60e3 }
  },
};

/* ── System clock ─────────────────────────────────────────────────────── */
function tickClock(){
  document.getElementById("sysClock").textContent =
    new Date().toLocaleTimeString("id-ID",{hour12:false});
}
tickClock(); setInterval(tickClock,1000);

/* ── Immersive mode ─────────────────────────────────────────────────── */
let immersive = false;
function toggleImmersive(){
  immersive = !immersive;
  document.getElementById("shell").classList.toggle("immersive", immersive);
  document.getElementById("imm-label").textContent = immersive ? "TAMPILKAN HUD" : "MODE IMERSIF";
}

/* ── Sidebar nav ─────────────────────────────────────────────────────── */
let activeFilter = null;

function setActiveNav(el, sensorKey) {
  // Toggle filter: clicking same sensor again clears filter
  if (activeFilter === sensorKey) {
    activeFilter = null;
  } else {
    activeFilter = sensorKey;
  }

  const cardMap = { temp:"card-temp", hum:"card-hum", gas:"card-gas", noise:"card-noise", light:"card-light" };
  const cards = ["card-temp", "card-hum", "card-gas", "card-noise", "card-light"];

  // Clear all active nav highlights
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));

  if (!activeFilter) {
    // Show all cards since no filter is active
    cards.forEach(id => {
      const c = document.getElementById(id);
      if (c) {
        c.style.display = "flex";
        c.style.opacity = "1";
        c.style.transform = "scale(1)";
        c.style.boxShadow = "";
      }
    });
  } else {
    // Highlight the clicked menu item
    el.classList.add("active");

    const target = cardMap[activeFilter];
    cards.forEach(id => {
      const c = document.getElementById(id);
      if (!c) return;
      if (id === target) {
        // Show selected card prominently
        c.style.display = "flex";
        c.style.opacity = "1";
        c.style.transform = "scale(1.02)";
        c.style.boxShadow = "0 0 20px rgba(0,219,231,0.25)";
      } else {
        // Hide unselected cards completely
        c.style.display = "none";
      }
    });
  }
}

/* ════════════════════════════════════════════════════════════════════════
   SPARKLINE renderer
════════════════════════════════════════════════════════════════════════ */
const sparkData = { temp:[], hum:[], gas:[], noise:[], light:[] };
const SPARK_MAX = 30;

function pushSpark(key, val) {
  sparkData[key].push(val);
  if (sparkData[key].length > SPARK_MAX) sparkData[key].shift();
}

function drawSparkline(svgEl, data, color) {
  if (!svgEl || data.length < 2) return;
  const W = svgEl.clientWidth || 220, H = svgEl.clientHeight || 22;
  const min = Math.min(...data), max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v,i) => {
    const x = (i / (data.length-1)) * W;
    const y = H - ((v - min) / range) * (H - 4) - 2;
    return `${x},${y}`;
  });
  const area = [...pts.map((p,i) => (i===0 ? 'M'+p : 'L'+p)),
    `L${W},${H}`, `L0,${H}`, 'Z'].join(' ');
  svgEl.innerHTML = `
    <defs>
      <linearGradient id="sg_${svgEl.id}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${area}" fill="url(#sg_${svgEl.id})"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  `;
}

function refreshSparklines() {
  drawSparkline(document.getElementById("spark-temp"),  sparkData.temp,  "#00dbe7");
  drawSparkline(document.getElementById("spark-hum"),   sparkData.hum,   "#00dbe7");
  drawSparkline(document.getElementById("spark-gas"),   sparkData.gas,   "#fe9800");
  drawSparkline(document.getElementById("spark-light"), sparkData.light, "#00dbe7");
  drawSparkline(document.getElementById("spark-noise"), sparkData.noise, "#fe9800");
}

/* ════════════════════════════════════════════════════════════════════════
   HISTORY CHART renderer (bottom panel)
════════════════════════════════════════════════════════════════════════ */
const histData = { temp:[], hum:[], gas:[], noise:[] };
const HIST_MAX = 60;

function pushHist(d) {
  ['temp','hum','gas','noise'].forEach(k => {
    if(d[k==='hum'?'humidity':k] !== undefined) {
       histData[k].push(d[k==='hum'?'humidity':k]);
       if (histData[k].length > HIST_MAX) histData[k].shift();
    }
  });
}

function drawChart(canvasEl, data, color, data2, color2) {
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d');
  const W = canvasEl.width = canvasEl.clientWidth * devicePixelRatio;
  const H = canvasEl.height = canvasEl.clientHeight * devicePixelRatio;
  ctx.clearRect(0,0,W,H);

  const allData = data2 ? [...data, ...data2] : data;
  if (allData.length < 2) return;
  const min = Math.min(...allData), max = Math.max(...allData);
  const range = max - min || 1;

  const drawLine = (arr, col) => {
    if (arr.length < 2) return;
    ctx.beginPath();
    arr.forEach((v,i) => {
      const x = (i / (arr.length-1)) * W;
      const y = H - ((v-min)/range)*(H-8)-4;
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5 * devicePixelRatio;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // area
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    const grad = ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0, col.replace(')',',0.15)').replace('rgb','rgba'));
    grad.addColorStop(1, col.replace(')',',0)').replace('rgb','rgba'));
    // fallback: manual alpha
    ctx.fillStyle = col + '18';
    ctx.fill();
  };

  // Grid lines
  ctx.strokeStyle = 'rgba(0,219,231,0.06)';
  ctx.lineWidth = 1;
  for (let i=0;i<4;i++) {
    const y = (i/3) * H;
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke();
  }

  drawLine(data, color);
  if (data2) drawLine(data2, color2);
}

function refreshCharts() {
  drawChart(document.getElementById("chart-temp"),  histData.temp,  '#00dbe7');
  drawChart(document.getElementById("chart-hum"),   histData.hum,   '#00dbe7');
  drawChart(document.getElementById("chart-gas"),   histData.gas,   '#fe9800', histData.noise, '#ff4560');
  document.getElementById("chart-temp-val").textContent = histData.temp.slice(-1)[0]?.toFixed(1) ?? '--';
  document.getElementById("chart-hum-val").textContent  = histData.hum.slice(-1)[0]?.toFixed(1)  ?? '--';
  document.getElementById("chart-gas-val").textContent  = histData.gas.slice(-1)[0]               ?? '--';
}

/* ════════════════════════════════════════════════════════════════════════
   RADIAL comfort score
════════════════════════════════════════════════════════════════════════ */
function setRadial(score, color) {
  const circ = 188.5;
  const offset = circ - (Math.min(100, Math.max(0, score)) / 100) * circ;
  const fill = document.getElementById("radial-fill");
  const scoreEl = document.getElementById("radial-score");
  fill.style.strokeDashoffset = offset;
  fill.style.stroke = color;
  fill.style.filter = `drop-shadow(0 0 6px ${color}80)`;
  scoreEl.textContent = score;
}

/* ════════════════════════════════════════════════════════════════════════
   Babylon.js SCENE (unchanged logic)
════════════════════════════════════════════════════════════════════════ */
function lerp3(a,b,t){ return new BABYLON.Color3(a.r+(b.r-a.r)*t, a.g+(b.g-a.g)*t, a.b+(b.b-a.b)*t); }

function tempToColor(temp){
  const S=[
    {t:14, c:new BABYLON.Color3(.10,.18,.68)},
    {t:18, c:new BABYLON.Color3(.20,.50,1.0)},
    {t:20, c:new BABYLON.Color3(.25,.86,.50)},
    {t:26, c:new BABYLON.Color3(.20,.80,.28)},
    {t:29, c:new BABYLON.Color3(.90,.76,.06)},
    {t:32, c:new BABYLON.Color3(.96,.30,.06)},
    {t:36, c:new BABYLON.Color3(.78,.03,.03)},
  ];
  if(temp<=S[0].t) return S[0].c;
  if(temp>=S[S.length-1].t) return S[S.length-1].c;
  for(let i=0;i<S.length-1;i++){
    if(temp>=S[i].t && temp<S[i+1].t){
      return lerp3(S[i].c, S[i+1].c, (temp-S[i].t)/(S[i+1].t-S[i].t));
    }
  }
  return S[3].c;
}

class ChairManager {
  constructor(scene, sharedMat){
    this.scene = scene; this.sharedMat = sharedMat; this.map = {};
    this.C_FREE = new BABYLON.Color3(.20,.23,.30);
    this.C_OCC  = new BABYLON.Color3(.90,.56,.06);
  }
  update(seats){
    const incoming = new Set(seats.map(s=>s.id));
    for(const id of Object.keys(this.map)) if(!incoming.has(id)) this._remove(id);
    const pos = this._grid(seats.length);
    seats.forEach((seat,i)=>{
      if(!this.map[seat.id]) this._build(seat.id, pos[i].x, pos[i].z);
      this._color(seat.id, seat.occupied ? this.C_OCC : this.C_FREE);
    });
  }
  _grid(n){
    if(!n) return [];
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n/cols);
    const gapX=2.3, gapZ=2.1;
    const oX=-(cols-1)*gapX/2, oZ=-(rows-1)*gapZ/2-.3;
    return Array.from({length:n},(_,i)=>({x:oX+(i%cols)*gapX, z:oZ+Math.floor(i/cols)*gapZ}));
  }
  _mk(id,nm,w,h,d,px,py,pz){
    const m=BABYLON.MeshBuilder.CreateBox(id+"_"+nm,{width:w,height:h,depth:d},this.scene);
    m.position.set(px,py,pz); m.material=this.sharedMat.clone(); return m;
  }
  _build(id,x,z){
    this.map[id]=[
      this._mk(id,"seat",1.05,.10,.95,x,.54,z),
      this._mk(id,"back",1.05,.92,.10,x,1.06,z-.43),
      this._mk(id,"l0",.08,.54,.08,x-.44,.27,z-.41),
      this._mk(id,"l1",.08,.54,.08,x+.44,.27,z-.41),
      this._mk(id,"l2",.08,.54,.08,x-.44,.27,z+.41),
      this._mk(id,"l3",.08,.54,.08,x+.44,.27,z+.41),
    ];
  }
  _color(id,c){ (this.map[id]||[]).forEach(m=>m.material.diffuseColor=c); }
  _remove(id){ (this.map[id]||[]).forEach(m=>m.dispose()); delete this.map[id]; }
}

class OccupancyManager {
  constructor(){ this._tmr=null; this._start=null; this._relay=false; this._prev=false; }
  update(anyOcc, motion){
    if(anyOcc){
      this._clear();
      if(!this._relay) this._set(true,"kursi terisi");
    } else {
      if(this._prev && !this._tmr){
        this._start=Date.now();
        this._tmr=setTimeout(()=>{
          this._set(false,"ruangan kosong selama 1 menit");
          this._tmr=null; this._start=null;
        }, CFG.occupancy.emptyMs);
      }
      if(motion && !this._relay) this._set(true,"PIR terdeteksi (ruangan kosong)");
    }
    this._prev=anyOcc;
    return {relay:this._relay, start:this._start, active:!!this._tmr};
  }
  _set(state,reason){
    if(this._relay===state) return;
    this._relay=state;
    alertMgr.push("occupancy",
      state?`Lampu DINYALAKAN — ${reason}`:`Lampu DIMATIKAN — ${reason}`,
      state?"info":"warn");
    sceneSetRelay(state);
  }
  _clear(){ if(this._tmr){clearTimeout(this._tmr);this._tmr=null;} this._start=null; }
  countdown(){
    if(!this._start) return "";
    const rem=Math.max(0,CFG.occupancy.emptyMs-(Date.now()-this._start));
    return rem>0?`MATI DALAM ${Math.ceil(rem/1000)}s`:"";
  }
}

class AlertManager {
  constructor(){
    this.log=[]; this.last={};
    this._body  = document.getElementById("logBody");
    this._count = document.getElementById("logCount");
    this._area  = document.getElementById("toastArea");
  }
  push(type,msg,sev="info"){
    const now=Date.now(), cd=CFG.alert.cd[type]??30e3;
    if(this.last[type]&&now-this.last[type]<cd) return;
    this.last[type]=now;
    const e={type,msg,sev,ts:now};
    this.log.unshift(e);
    if(this.log.length>150) this.log.pop();
    this._count.textContent=this.log.length>99?"99+":this.log.length;
    this._addRow(e); this._toast(e);
  }
  _label(t){ return {temp:"SUHU",hum:"KELEMBABAN",gas:"GAS",noise:"KEBISINGAN",occupancy:"OKUPANSI",comfort:"KENYAMANAN"}[t]||(t.toUpperCase()); }
  _fmtTs(ts){ return new Date(ts).toLocaleTimeString("id-ID",{hour12:false}); }
  _toast(e){
    const d=document.createElement("div");
    d.className=`toast ${e.sev}`;
    d.innerHTML=`<span class="t-type">${this._label(e.type)}</span><span class="t-msg">${e.msg}</span><span class="t-ts">${this._fmtTs(e.ts)}</span>`;
    this._area.prepend(d);
    setTimeout(()=>{ d.style.opacity="0"; d.style.transform="translateX(12px)"; setTimeout(()=>d.remove(),420); },6e3);
    while(this._area.children.length>3) this._area.lastChild.remove();
  }
  _addRow(e){
    const sv={ok:"b-ok",warn:"b-warn",crit:"b-crit",info:"b-info"}[e.sev]||"b-off";
    const r=document.createElement("div"); r.className="log-row";
    r.innerHTML=`<span class="log-ts">${this._fmtTs(e.ts)}</span><span class="nav-badge ${sv}">${this._label(e.type)}</span><span class="log-msg">${e.msg}</span>`;
    this._body.firstChild?this._body.insertBefore(r,this._body.firstChild):this._body.appendChild(r);
  }
}

/* ── Babylon scene ─────────────────────────────────────────────────── */
const canvas = document.getElementById("renderCanvas");
const engine = new BABYLON.Engine(canvas, true);
let wallMat, frontWallMat, lampPtLight, lampPanelMat, pirMat, chairMgr;
let curWall = new BABYLON.Color3(.20,.80,.28);
let tgtWall = curWall.clone();

const scene = (()=>{
  const sc = new BABYLON.Scene(engine);
  sc.clearColor = new BABYLON.Color4(0, 0, 0, 0);
  const cam = new BABYLON.ArcRotateCamera("cam",Math.PI/4,Math.PI/3.2,22,new BABYLON.Vector3(0,1.5,0),sc);
  cam.attachControl(canvas,true);
  cam.lowerRadiusLimit=8; cam.upperRadiusLimit=40; cam.upperBetaLimit=Math.PI/2-.04;
  const hemi = new BABYLON.HemisphericLight("hemi",new BABYLON.Vector3(0,1,0),sc);
  hemi.intensity=.45; hemi.diffuse=new BABYLON.Color3(.8,.9,1); hemi.groundColor=new BABYLON.Color3(.06,.07,.10);
  lampPtLight = new BABYLON.PointLight("ptL",new BABYLON.Vector3(0,3.5,0),sc);
  lampPtLight.intensity=.1; lampPtLight.diffuse=new BABYLON.Color3(1,.97,.88);
  const mat=(r,g,b,spec=.05,alpha=1)=>{
    const m=new BABYLON.StandardMaterial("m"+Math.random(),sc);
    m.diffuseColor=new BABYLON.Color3(r,g,b);
    m.specularColor=new BABYLON.Color3(spec,spec,spec);
    if(alpha<1){m.alpha=alpha; m.backFaceCulling=false;}
    return m;
  };
  wallMat=mat(.20,.80,.28); wallMat.specularColor=new BABYLON.Color3(.03,.03,.03);
  frontWallMat=mat(.20,.80,.28,.03,.08);
  lampPanelMat=new BABYLON.StandardMaterial("lpm",sc); lampPanelMat.emissiveColor=new BABYLON.Color3(.05,.05,.05);
  pirMat=new BABYLON.StandardMaterial("pirm",sc); pirMat.emissiveColor=new BABYLON.Color3(.08,.08,.08);
  const floorMat=mat(.15,.17,.21,.35), ceilMat=mat(.11,.13,.17,.02);
  const doorFrMat=mat(.50,.44,.36,.12), doorPMat=mat(.32,.27,.22,.18);
  const deskMat=mat(.50,.37,.25,.15);
  const box=(nm,w,h,d,x,y,z,m)=>{
    const mb=BABYLON.MeshBuilder.CreateBox(nm,{width:w,height:h,depth:d},sc);
    mb.position.set(x,y,z); mb.material=m; return mb;
  };
  const {W,D,H,doorX,doorW,doorH,frontZ}=CFG.room;
  const fl=BABYLON.MeshBuilder.CreateGround("floor",{width:W,height:D},sc); fl.material=floorMat;
  box("ceil",W,.08,D,0,H,0,ceilMat);
  box("wBack",W,H,.15,0,H/2,-D/2,wallMat);
  box("wLeft",.15,H,D,-W/2,H/2,0,wallMat);
  box("wRight",.15,H,D,W/2,H/2,0,wallMat);
  const dL=doorX-doorW/2, dR=doorX+doorW/2;
  const wL=dL-(-W/2); box("fwL",wL,H,.15,(-W/2+dL)/2,H/2,frontZ,frontWallMat);
  const wR=W/2-dR;    box("fwR",wR,H,.15,(dR+W/2)/2,H/2,frontZ,frontWallMat);
  const wTop=H-doorH; box("fwT",doorW+.22,wTop,.15,doorX,doorH+wTop/2,frontZ,frontWallMat);
  box("frL",.10,doorH+.10,.14,dL,doorH/2,frontZ,doorFrMat);
  box("frR",.10,doorH+.10,.14,dR,doorH/2,frontZ,doorFrMat);
  box("frT",doorW+.22,.10,.14,doorX,doorH,frontZ,doorFrMat);
  box("door",doorW-.06,doorH-.06,.07,doorX,doorH/2,frontZ,doorPMat);
  const hndl=BABYLON.MeshBuilder.CreateCylinder("hndl",{diameter:.06,height:.20,tessellation:12},sc);
  hndl.rotation.z=Math.PI/2; hndl.position.set(doorX+.56,doorH/2,frontZ-.08);
  const hm=new BABYLON.StandardMaterial("hm",sc);
  hm.diffuseColor=new BABYLON.Color3(.68,.55,.16); hm.specularColor=new BABYLON.Color3(1,.9,.4); hndl.material=hm;
  const pir=BABYLON.MeshBuilder.CreateCylinder("pir",{diameter:.26,height:.05,tessellation:32},sc);
  pir.rotation.x=Math.PI/2; pir.position.set(doorX,doorH+.22,frontZ-.11); pir.material=pirMat;
  box("lmpB",2.2,.06,.42,0,H-.06,0,mat(.12,.13,.17,.02));
  box("lmpP",2.0,.02,.34,0,H-.10,0,lampPanelMat);
  box("desk",1.6,.07,.9,0,.74,.90,deskMat);
  [[-0.72,.44],[.72,.44],[-0.72,1.28],[.72,1.28]].forEach(([lx,lz],i)=>
    box("dl"+i,.07,.74,.07,lx,.37,lz,deskMat));
  const chairMat_=mat(.20,.23,.30,.32); chairMat_.specularColor=new BABYLON.Color3(.3,.3,.4);
  chairMgr=new ChairManager(sc,chairMat_);
  sc.registerBeforeRender(()=>{
    curWall=lerp3(curWall,tgtWall,.026);
    wallMat.diffuseColor=curWall;
    frontWallMat.diffuseColor=curWall;
  });
  return sc;
})();

engine.runRenderLoop(()=>scene.render());
window.addEventListener("resize",()=>engine.resize());

function sceneSetRelay(on){
  if(!lampPtLight||!lampPanelMat) return;
  lampPanelMat.emissiveColor=on?new BABYLON.Color3(1,.97,.88):new BABYLON.Color3(.05,.05,.05);
  lampPtLight.intensity=on?1.9:.1;
}
function sceneSetPir(on){
  if(!pirMat) return;
  pirMat.emissiveColor=on?new BABYLON.Color3(1.0,.40,.0):new BABYLON.Color3(.08,.08,.08);
}

/* ════════════════════════════════════════════════════════════════════════
   HUD helpers
════════════════════════════════════════════════════════════════════════ */
const $=id=>document.getElementById(id);
function bd(el,txt,cls){ el.textContent=txt; el.className="nav-badge "+cls; }

function analyzeComfort(d){
  const s=d.comfort_score??0, i=[], t=CFG.thr;
  if(d.temp<t.temp.lo)         i.push("suhu terlalu dingin");
  else if(d.temp>t.temp.hi)    i.push("suhu terlalu panas");
  else if(d.temp>t.temp.wHi)   i.push("suhu agak hangat");
  if(d.humidity<t.hum.lo)      i.push("udara terlalu kering");
  else if(d.humidity>t.hum.hi) i.push("udara terlalu lembab");
  if(d.gas>t.gas.hi)           i.push("kualitas udara buruk");
  else if(d.gas>t.gas.w)       i.push("kualitas udara kurang");
  if(d.noise>t.noise.hi)       i.push("terlalu bising");
  else if(d.noise>t.noise.w)   i.push("agak bising");
  if(s>=75&&!i.length) return {text:"Ruangan Nyaman ✓", cls:"b-ok",  col:"#00dbe7", radialCol:"#00dbe7"};
  if(s>=50)            return {text:"Cukup Nyaman"+(i.length?` — ${i[0]}`:""), cls:"b-warn", col:"#fe9800", radialCol:"#fe9800"};
  return               {text:"Tidak Nyaman — "+(i[0]||"periksa sensor"), cls:"b-crit", col:"#ff4560", radialCol:"#ff4560"};
}

function checkAlerts(d){
  const t=CFG.thr;
  if(d.temp>t.temp.hi)        alertMgr.push("temp",`Suhu sangat tinggi: ${d.temp.toFixed(1)}°C`,"crit");
  else if(d.temp>t.temp.wHi)  alertMgr.push("temp",`Suhu agak tinggi: ${d.temp.toFixed(1)}°C`,"warn");
  else if(d.temp<t.temp.lo)   alertMgr.push("temp",`Suhu terlalu rendah: ${d.temp.toFixed(1)}°C`,"warn");
  if(d.gas>t.gas.hi)          alertMgr.push("gas",`Gas berbahaya: ${d.gas}/100`,"crit");
  else if(d.gas>t.gas.w)      alertMgr.push("gas",`Gas meningkat: ${d.gas}/100`,"warn");
  if(d.noise>t.noise.hi)      alertMgr.push("noise",`Sangat bising: ${d.noise}/100`,"crit");
  else if(d.noise>t.noise.w)  alertMgr.push("noise",`Agak bising: ${d.noise}/100`,"warn");
  if(d.humidity>t.hum.hi)     alertMgr.push("hum",`Kelembaban tinggi: ${d.humidity.toFixed(0)}%`,"warn");
  else if(d.humidity<t.hum.lo)alertMgr.push("hum",`Kelembaban rendah: ${d.humidity.toFixed(0)}%`,"warn");
  const cf=analyzeComfort(d);
  if((d.comfort_score??100)<50) alertMgr.push("comfort",cf.text,"warn");
}

/* ── Sensor card state ──────────────────────────────────────────────── */
function setCardState(cardId, state) {
  const card = $(cardId);
  if (!card) return;
  card.className = `sensor-card state-${state}`;
}

function updateHUD(d, seats, occInfo) {
  const t = CFG.thr;

  // Temp
  if (d.temp !== undefined) {
    $("vTemp").textContent = d.temp.toFixed(1);
    $("nav-temp").textContent = d.temp.toFixed(1) + "°C";
    const tempState = d.temp<t.temp.lo||d.temp>t.temp.hi ? "crit" : d.temp>t.temp.wHi ? "warn" : "ok";
    const tempLabel = d.temp<t.temp.lo?"DINGIN":d.temp>t.temp.hi?"PANAS":d.temp>t.temp.wHi?"HANGAT":"NORMAL";
    bd($("bTemp"), tempLabel, "b-"+tempState);
    setCardState("card-temp", tempState);
    const tempPct = Math.min(100, Math.max(5, ((d.temp - 14)/(40-14))*100));
    $("therm-temp").style.height = tempPct + "%";
  }

  // Humidity
  if (d.humidity !== undefined) {
    $("vHum").textContent = d.humidity.toFixed(1);
    $("nav-hum").textContent = d.humidity.toFixed(1) + "%";
    const humState = (d.humidity<t.hum.lo||d.humidity>t.hum.hi) ? "warn" : "ok";
    const humLabel = d.humidity<t.hum.lo?"KERING":d.humidity>t.hum.hi?"LEMBAB":"NORMAL";
    bd($("bHum"), humLabel, "b-"+humState);
    setCardState("card-hum", humState);
    const humPct = Math.min(100, Math.max(5, d.humidity));
    $("therm-hum").style.height = humPct + "%";
  }

  // Gas
  if (d.gas !== undefined) {
    $("vGas").textContent = d.gas;
    const gasState = d.gas>t.gas.hi ? "crit" : d.gas>t.gas.w ? "warn" : "ok";
    const gasLabel = d.gas>t.gas.hi?"BAHAYA!":d.gas>t.gas.w?"WASPADA":"NORMAL";
    bd($("bGas"), gasLabel, "b-"+gasState);
    bd($("nav-gas-badge"), gasLabel, "b-"+gasState);
    setCardState("card-gas", gasState);
    const gasPct = Math.min(100, Math.max(5, d.gas));
    $("therm-gas").style.height = gasPct + "%";
  }
  
  // Light
  if (d.light !== undefined) {
    $("vLight").textContent = d.light;
    $("nav-light").textContent = d.light + " lx";
    const lightPct = Math.min(100, Math.max(5, (d.light / 1000) * 100)); // asumsi max 1000lx
    $("therm-light").style.height = lightPct + "%";
  }

  // Noise
  if (d.noise !== undefined) {
    $("vNoise").textContent = d.noise;
    $("nav-noise").textContent = d.noise + " dB";
    const noiseState = d.noise>t.noise.hi ? "crit" : d.noise>t.noise.w ? "warn" : "ok";
    const noiseLabel = d.noise>t.noise.hi?"BISING!":d.noise>t.noise.w?"SEDANG":"OK";
    bd($("bNoise"), noiseLabel, "b-"+noiseState);
    setCardState("card-noise", noiseState);
    const noisePct = Math.min(100, Math.max(5, d.noise));
    $("therm-noise").style.height = noisePct + "%";
  }

  // Occupancy
  const occ = seats.filter(s=>s.occupied).length;
  bd($("bOcc"), `${occ}/${seats.length}`, occ>0?"b-ok":"b-off");
  bd($("bPir"), d.motion?"TERDETEKSI":"IDLE", d.motion?"b-warn":"b-off");

  // Relay
  const relOn = occInfo.relay;
  $("relayLamp").className = "relay-toggle" + (relOn?" on":"");
  $("relayFan").className  = "relay-toggle" + (relOn?" on":"");

  // Comfort
  const cf = analyzeComfort(d);
  $("radial-label-text").textContent = cf.text.split("—")[0].trim();
  $("radial-label-text").style.color = cf.col;
  setRadial(d.comfort_score ?? 0, cf.radialCol);

  $("critBanner").style.display = d.critical_cut ? "block" : "none";

  // 3D Updates
  if (d.temp !== undefined) tgtWall = tempToColor(d.temp);
  sceneSetPir(d.motion);
  sceneSetRelay(relOn);

  // Charts & sparklines
  if (d.temp !== undefined) pushSpark("temp", d.temp);
  if (d.humidity !== undefined) pushSpark("hum",  d.humidity);
  if (d.gas !== undefined) pushSpark("gas",  d.gas);
  if (d.light !== undefined) pushSpark("light", d.light);
  if (d.noise !== undefined) pushSpark("noise",d.noise);
  
  refreshSparklines();
  pushHist(d);
  refreshCharts();
}

/* ════════════════════════════════════════════════════════════════════════
   INSTANTIATE
════════════════════════════════════════════════════════════════════════ */
const alertMgr = new AlertManager();
const occMgr   = new OccupancyManager();
let   occInfo  = {relay:false,start:null,active:false};

setInterval(()=>{ $("emptyTimer").textContent = occMgr.countdown(); }, 1000);

function onData(d){
  let seats = Array.isArray(d.seats)&&d.seats.length
    ? d.seats
    : [{id:"seat_1", occupied:!!d.occupied, weight:d.weight??0}];
  chairMgr.update(seats);
  occInfo = occMgr.update(seats.some(s=>s.occupied), !!d.motion);
  checkAlerts(d);
  updateHUD(d, seats, occInfo);
}

/* ════════════════════════════════════════════════════════════════════════
   MQTT (unchanged)
════════════════════════════════════════════════════════════════════════ */
const mqttCl = mqtt.connect(CFG.mqtt.broker,{
  clientId:CFG.mqtt.clientId, clean:true, reconnectPeriod:3000, connectTimeout:8000,
});
mqttCl.on("connect",()=>{
  $("mqttPill").className="ok"; $("mqttTxt").textContent="MQTT CONNECTED";
  mqttCl.subscribe(CFG.mqtt.topic,{qos:0});
  alertMgr.push("occupancy","Terhubung ke broker MQTT","info");
});
mqttCl.on("reconnect",()=>{ $("mqttPill").className="wait"; $("mqttTxt").textContent="RECONNECTING…"; });
mqttCl.on("error",()=>{     $("mqttPill").className="err";  $("mqttTxt").textContent="MQTT ERROR"; });
mqttCl.on("offline",()=>{   $("mqttPill").className="err";  $("mqttTxt").textContent="OFFLINE"; });
mqttCl.on("message",(_,msg)=>{ try{ onData(JSON.parse(msg.toString())); }catch(e){ console.warn(e); } });