/* 調査位置立会ビューア — オフライン用 Service Worker */
const APP   = 'bview-app-v2';
const TILES = 'bview-tiles-v1';
const SHELL = ['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png'];
const TILE_HOST = /(^|\.)(cyberjapandata\.gsi\.go\.jp|tile\.openstreetmap\.org)$/;

self.addEventListener('install', e=>{
  e.waitUntil(
    caches.open(APP).then(c=>Promise.allSettled(SHELL.map(u=>c.add(u))))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==APP&&k!==TILES).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  const req = e.request;
  if(req.method!=='GET') return;
  let u; try{ u=new URL(req.url); }catch(_){ return; }

  /* 地図タイル：キャッシュ優先（保存済みなら圏外でも表示） */
  if(TILE_HOST.test(u.hostname)){
    e.respondWith((async()=>{
      const c = await caches.open(TILES);
      const hit = await c.match(req,{ignoreVary:true});
      if(hit) return hit;
      try{
        const res = await fetch(req);
        try{ await c.put(req, res.clone()); }catch(_){}
        return res;
      }catch(_){
        return new Response('', {status:504, statusText:'offline'});
      }
    })());
    return;
  }

  /* アプリ本体：通信優先（更新を必ず拾う）、圏外ならキャッシュ */
  if(u.origin===self.location.origin){
    e.respondWith((async()=>{
      const c = await caches.open(APP);
      try{
        const res = await fetch(req);
        if(res && res.status===200){ try{ await c.put(req,res.clone()); }catch(_){} }
        return res;
      }catch(_){
        const hit = await c.match(req,{ignoreSearch:true});
        if(hit) return hit;
        const idx = await c.match('./index.html');
        return idx || new Response('', {status:504});
      }
    })());
  }
});

self.addEventListener('message', e=>{
  const d = e.data||{};
  if(d.type==='prefetch') e.waitUntil(prefetch(d.urls||[]));
  if(d.type==='clear')    e.waitUntil(caches.delete(TILES).then(()=>post({type:'cleared'})));
});

async function prefetch(urls){
  const c = await caches.open(TILES);
  const queue = urls.slice();
  const total = urls.length;
  let done=0, fail=0;
  const worker = async () => {
    while(queue.length){
      const url = queue.shift();
      try{
        const req = new Request(url, {mode:'no-cors'});
        const hit = await c.match(req,{ignoreVary:true});
        if(!hit){ const r = await fetch(req); await c.put(req, r); }
      }catch(_){ fail++; }
      done++;
      if(done%15===0 || !queue.length) post({type:'progress', done, total, fail});
    }
  };
  await Promise.all(Array.from({length:6}, worker));
  post({type:'done', done, total, fail});
}

async function post(msg){
  const cs = await self.clients.matchAll({includeUncontrolled:true});
  cs.forEach(c=>c.postMessage(msg));
}
