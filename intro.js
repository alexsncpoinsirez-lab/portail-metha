/* =====================================================================
   INTRO D'OUVERTURE — « Agrienergies Ultimate Fighting »
   Spirale d'énergie verte / bleue → logo gel sur plaque alu brossé
   → 2 battements de cœur → phrase + voix caverneuse → l'appli.

   Se joue à chaque ouverture. Un écran « Toucher pour entrer » est
   nécessaire : les téléphones bloquent le son tant qu'on n'a pas touché l'écran.
   Fichiers utilisés : icons/intro-logo.png, icons/intro-voix.mp3, icons/alu.jpg
   Pour couper l'intro : retirer la ligne <script src="intro.js"> de index.html.
   ===================================================================== */
(function () {
  'use strict';

  // Pas d'intro si l'appli vient juste de se recharger (mise à jour) ou si le téléphone demande moins d'animations
  var reduit = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var recent = false;
  try { recent = Date.now() - (+sessionStorage.getItem('ix_vu') || 0) < 30000; } catch (e) {}
  if (reduit || recent) return;

  /* ================= Chronologie (secondes) ================= */
  var T = {
    implosion: 2.5, impact: 2.85,
    coeur1: 4.0, coeur2: 5.5,
    phrase: 7.0, voix: 7.1, phrase2: 9.6, reflet: 10.5,
    sortie: 12.1, fin: 12.8
  };

  /* ================= Styles (préfixe ix- pour ne rien casser dans l'appli) ================= */
  var css = [
    '#ix{position:fixed;inset:0;z-index:99999;background:#05080f;overflow:hidden;color:#e6f1ff;-webkit-user-select:none;user-select:none;',
    '--ix-vert:#22e3a1;--ix-bleu:#38b6ff;--ix-neon:#38e1ff;--ix-logo:url("icons/intro-logo.png");',
    '--ix-display:"Saira Extra Condensed","Arial Narrow",Impact,sans-serif;--ix-mono:"JetBrains Mono",ui-monospace,Menlo,monospace}',
    '#ix canvas{position:absolute;inset:0;width:100%;height:100%;display:block}',
    '.ix-grille{position:absolute;inset:-20%;pointer-events:none;opacity:0;background-image:linear-gradient(rgba(56,225,255,.08) 1px,transparent 1px),linear-gradient(90deg,rgba(56,225,255,.08) 1px,transparent 1px);background-size:44px 44px;-webkit-mask-image:radial-gradient(circle at 50% 50%,#000 0 35%,transparent 70%);mask-image:radial-gradient(circle at 50% 50%,#000 0 35%,transparent 70%)}',
    '.ix-balayage{position:absolute;inset:0;pointer-events:none;opacity:.35;background:repeating-linear-gradient(0deg,rgba(0,0,0,.35) 0 1px,transparent 1px 3px)}',
    '.ix-hud{position:absolute;inset:calc(14px + env(safe-area-inset-top,0px)) 14px calc(14px + env(safe-area-inset-bottom,0px));pointer-events:none;font-family:var(--ix-mono);font-size:10px;letter-spacing:.14em;color:rgba(56,225,255,.7);text-transform:uppercase;opacity:0}',
    '.ix-c{position:absolute;width:22px;height:22px;border:1.5px solid currentColor}',
    '.ix-c.tl{top:0;left:0;border-right:0;border-bottom:0}.ix-c.tr{top:0;right:0;border-left:0;border-bottom:0}.ix-c.bl{bottom:0;left:0;border-right:0;border-top:0}.ix-c.br{bottom:0;right:0;border-left:0;border-top:0}',
    '.ix-t{position:absolute}.ix-t1{top:4px;left:34px}.ix-t2{top:4px;right:34px}.ix-t3{bottom:4px;left:34px}.ix-t4{bottom:4px;right:34px;font-variant-numeric:tabular-nums}',
    '.ix-flash{position:absolute;inset:0;background:radial-gradient(circle at 50% 46%,#fff 0,#bff7ea 18%,rgba(56,182,255,0) 60%);opacity:0;pointer-events:none;mix-blend-mode:screen}',
    '.ix-centre{position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);width:min(78vw,420px);display:grid;justify-items:center;gap:22px;pointer-events:none}',
    '.ix-plaque{position:relative;width:min(64vw,36vh,300px);aspect-ratio:1/.92;display:grid;place-items:center;border-radius:12px;opacity:0;will-change:transform,opacity,filter;',
    'background:#c9cdd1 url("icons/alu.jpg") center/cover no-repeat;border:1px solid rgba(210,222,235,.7);',
    'box-shadow:inset 0 2px 0 rgba(255,255,255,.95),inset 2px 0 0 rgba(255,255,255,.5),inset 0 -3px 0 rgba(0,0,0,.28),inset -2px 0 0 rgba(0,0,0,.18),inset 0 0 0 5px rgba(255,255,255,.08),0 14px 34px rgba(0,0,0,.65)}',
    '.ix-vis{position:absolute;width:9px;height:9px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff,#8a9198 60%,#4a5158);box-shadow:inset 0 0 0 1px rgba(0,0,0,.3),0 1px 0 rgba(255,255,255,.6)}',
    '.ix-vis::after{content:"";position:absolute;left:1px;right:1px;top:4px;height:1.4px;background:rgba(40,45,50,.65);transform:rotate(-35deg)}',
    '.ix-vis.a{top:9px;left:9px}.ix-vis.b{top:9px;right:9px}.ix-vis.c{bottom:9px;left:9px}.ix-vis.d{bottom:9px;right:9px}',
    '.ix-gel{position:relative;width:78%;aspect-ratio:609/607;background:var(--ix-logo) center/contain no-repeat;filter:drop-shadow(0 3px 2px rgba(0,0,0,.35)) drop-shadow(0 8px 10px rgba(0,0,0,.25))}',
    '.ix-gel::after{content:"";position:absolute;inset:0;pointer-events:none;opacity:0;background:linear-gradient(105deg,transparent 40%,rgba(255,255,255,.95) 49%,rgba(255,255,255,.35) 53%,transparent 60%) 130% 0/320% 100% no-repeat;',
    '-webkit-mask:var(--ix-logo) center/contain no-repeat;mask:var(--ix-logo) center/contain no-repeat}',
    '.ix-plaque.ix-brille .ix-gel::after{animation:ixReflet 1.1s cubic-bezier(.35,.6,.35,1) forwards}',
    '@keyframes ixReflet{0%{background-position:130% 0;opacity:1}100%{background-position:-30% 0;opacity:1}}',
    '.ix-coin{position:absolute;width:18px;height:18px;border:2px solid var(--ix-bleu);filter:drop-shadow(0 0 4px var(--ix-bleu))}',
    '.ix-coin.a{top:-12px;left:-12px;border-right:0;border-bottom:0}.ix-coin.b{top:-12px;right:-12px;border-left:0;border-bottom:0}',
    '.ix-coin.c{bottom:-12px;left:-12px;border-right:0;border-top:0;border-color:var(--ix-vert);filter:drop-shadow(0 0 4px var(--ix-vert))}',
    '.ix-coin.d{bottom:-12px;right:-12px;border-left:0;border-top:0;border-color:var(--ix-vert);filter:drop-shadow(0 0 4px var(--ix-vert))}',
    '.ix-choc{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 46%,transparent 25%,rgba(0,0,0,.85) 80%)}',
    '.ix-phrase{font-family:var(--ix-display);font-weight:800;text-transform:uppercase;text-align:center;line-height:.95;opacity:0;font-size:clamp(28px,8.4vw,52px);letter-spacing:.05em;color:#e6f1ff;white-space:nowrap;',
    'text-shadow:-2px 0 rgba(34,227,161,.75),2px 0 rgba(56,182,255,.8),0 0 24px rgba(56,182,255,.45)}',
    '.ix-l2{display:block;font-size:.56em;letter-spacing:.2em;margin-top:6px;color:var(--ix-neon);padding-left:.2em}',
    '.ix-trait{width:0;height:2px;background:linear-gradient(90deg,transparent,var(--ix-neon),transparent);box-shadow:0 0 10px var(--ix-neon)}',
    '.ix-passer{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(46px + env(safe-area-inset-bottom,0px));z-index:3;-webkit-appearance:none;appearance:none;background:rgba(0,0,0,.35);border:1px solid rgba(130,200,255,.18);color:#8ea3bd;font-family:var(--ix-mono);font-size:11px;letter-spacing:.14em;text-transform:uppercase;padding:9px 14px;border-radius:8px;cursor:pointer}',
    /* écran « toucher pour entrer » */
    '.ix-porte{position:absolute;inset:0;z-index:4;display:grid;place-items:center;cursor:pointer;-webkit-tap-highlight-color:transparent;background:radial-gradient(circle at 50% 46%,rgba(34,227,161,.08),transparent 55%)}',
    '.ix-porte-boite{display:grid;justify-items:center;gap:22px;pointer-events:none}',
    '.ix-anneau{width:120px;height:120px;border-radius:50%;border:2px solid var(--ix-vert);box-shadow:0 0 24px rgba(34,227,161,.5),inset 0 0 24px rgba(56,182,255,.35);position:relative;animation:ixPulse 1.6s ease-in-out infinite}',
    '.ix-anneau::before{content:"";position:absolute;inset:14px;border-radius:50%;border:2px solid var(--ix-bleu);border-left-color:transparent;border-right-color:transparent;animation:ixTourne 2.2s linear infinite}',
    '.ix-anneau::after{content:"";position:absolute;left:50%;top:50%;width:0;height:0;margin:-14px 0 0 -9px;border-style:solid;border-width:14px 0 14px 24px;border-color:transparent transparent transparent #e6f1ff;filter:drop-shadow(0 0 8px var(--ix-neon))}',
    '.ix-porte-txt{font-family:var(--ix-mono);font-weight:700;font-size:13px;letter-spacing:.3em;text-transform:uppercase;color:var(--ix-neon);text-shadow:0 0 12px rgba(56,225,255,.6);animation:ixClign 1.6s ease-in-out infinite;padding-left:.3em}',
    '.ix-porte-sous{font-family:var(--ix-mono);font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#8ea3bd}',
    '@keyframes ixPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}',
    '@keyframes ixTourne{to{transform:rotate(360deg)}}',
    '@keyframes ixClign{0%,100%{opacity:1}50%{opacity:.45}}'
  ].join('');

  var html =
    '<div class="ix-grille"></div><canvas></canvas><div class="ix-flash"></div>' +
    '<div class="ix-centre">' +
      '<div class="ix-plaque" role="img" aria-label="Logo AgriEnergies">' +
        '<span class="ix-vis a"></span><span class="ix-vis b"></span><span class="ix-vis c"></span><span class="ix-vis d"></span>' +
        '<div class="ix-gel"></div>' +
        '<span class="ix-coin a"></span><span class="ix-coin b"></span><span class="ix-coin c"></span><span class="ix-coin d"></span>' +
      '</div>' +
      '<div class="ix-trait"></div>' +
      '<div class="ix-phrase"><span class="ix-l1"></span><span class="ix-l2"></span></div>' +
    '</div>' +
    '<div class="ix-choc"></div><div class="ix-balayage"></div>' +
    '<div class="ix-hud"><span class="ix-c tl"></span><span class="ix-c tr"></span><span class="ix-c bl"></span><span class="ix-c br"></span>' +
      '<span class="ix-t ix-t1">Portail Métha</span><span class="ix-t ix-t2 ix-etat">En attente</span>' +
      '<span class="ix-t ix-t3">Baudrecourt 57</span><span class="ix-t ix-t4 ix-chrono">T+00.00</span></div>' +
    '<div class="ix-porte" role="button" tabindex="0" aria-label="Toucher pour entrer">' +
      '<div class="ix-porte-boite"><div class="ix-anneau"></div><div class="ix-porte-txt">Toucher pour entrer</div><div class="ix-porte-sous">Monte le son</div></div>' +
    '</div>' +
    '<button class="ix-passer" type="button">Passer ›</button>';

  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var ix = document.createElement('div'); ix.id = 'ix'; ix.innerHTML = html;
  function q(s) { return ix.querySelector(s); }
  var ancienOverflow = '';
  function monter() {
    document.body.appendChild(ix);
    ancienOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    taille(); dessinerAttente();
  }

  /* ================= Voix (fichier préchargé dès l'ouverture) ================= */
  var voixOctets = null, voixBuffer = null;
  try { fetch('icons/intro-voix.mp3').then(function (r) { return r.ok ? r.arrayBuffer() : null; }).then(function (b) { voixOctets = b; }).catch(function () {}); } catch (e) {}

  /* ================= Sons (Web Audio) ================= */
  var AC = null;
  function bruit(ctx, sec) {
    var b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * sec), ctx.sampleRate), d = b.getChannelData(0), last = 0;
    for (var i = 0; i < d.length; i++) { var w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
    return b;
  }
  function programmerSons(t0) {
    var ctx = AC, out = ctx.createDynamicsCompressor(); out.threshold.value = -10; out.ratio.value = 3; out.knee.value = 6; out.connect(ctx.destination);
    var maitre = ctx.createGain(); maitre.gain.value = 0.95; maitre.connect(out);

    // 1) Souffle de la spirale + grondement
    var src = ctx.createBufferSource(); src.buffer = bruit(ctx, 4);
    var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(180, t0); bp.frequency.exponentialRampToValueAtTime(900, t0 + T.implosion); bp.frequency.exponentialRampToValueAtTime(2600, t0 + T.impact);
    var g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.9, t0 + 1.6);
    g.gain.setValueAtTime(0.9, t0 + T.implosion); g.gain.exponentialRampToValueAtTime(1.4, t0 + T.impact - 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + T.impact + 0.08);
    var lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 9; lg.gain.value = 0.25; lfo.connect(lg); lg.connect(g.gain);
    src.connect(bp); bp.connect(g); g.connect(maitre);
    var gr = ctx.createOscillator(), grg = ctx.createGain(); gr.type = 'sawtooth'; gr.frequency.setValueAtTime(38, t0); gr.frequency.linearRampToValueAtTime(55, t0 + T.impact);
    var grf = ctx.createBiquadFilter(); grf.type = 'lowpass'; grf.frequency.value = 140;
    grg.gain.setValueAtTime(0.0001, t0); grg.gain.exponentialRampToValueAtTime(0.35, t0 + 2); grg.gain.exponentialRampToValueAtTime(0.0001, t0 + T.impact + 0.05);
    gr.connect(grf); grf.connect(grg); grg.connect(maitre);
    src.start(t0); src.stop(t0 + T.impact + 0.2); lfo.start(t0); lfo.stop(t0 + T.impact + 0.2); gr.start(t0); gr.stop(t0 + T.impact + 0.2);
    var asp = ctx.createBufferSource(); asp.buffer = bruit(ctx, 0.5);
    var af = ctx.createBiquadFilter(); af.type = 'highpass'; af.frequency.setValueAtTime(300, t0 + T.implosion); af.frequency.exponentialRampToValueAtTime(5000, t0 + T.impact);
    var ag = ctx.createGain(); ag.gain.setValueAtTime(0.0001, t0 + T.implosion); ag.gain.exponentialRampToValueAtTime(0.6, t0 + T.impact - 0.01); ag.gain.linearRampToValueAtTime(0, t0 + T.impact);
    asp.connect(af); af.connect(ag); ag.connect(maitre); asp.start(t0 + T.implosion); asp.stop(t0 + T.impact + 0.05);

    // 2) Impact
    boum(t0 + T.impact, 1.0, 95, 28, 1.1);
    var ec = ctx.createBufferSource(); ec.buffer = bruit(ctx, 1.2);
    var ef = ctx.createBiquadFilter(); ef.type = 'lowpass'; ef.frequency.setValueAtTime(6000, t0 + T.impact); ef.frequency.exponentialRampToValueAtTime(300, t0 + T.impact + 1.1);
    var eg = ctx.createGain(); eg.gain.setValueAtTime(0.7, t0 + T.impact); eg.gain.exponentialRampToValueAtTime(0.0001, t0 + T.impact + 1.1);
    ec.connect(ef); ef.connect(eg); eg.connect(maitre); ec.start(t0 + T.impact);

    // 3) Deux battements de cœur (lub… dub)
    [T.coeur1, T.coeur2].forEach(function (t) {
      boum(t0 + t, 1.0, 90, 30, 0.7); sub(t0 + t, 1.0, 46, 0.9);
      boum(t0 + t + 0.3, 0.85, 75, 28, 0.6); sub(t0 + t + 0.3, 0.8, 42, 0.8);
    });

    // 4) Voix
    function jouerVoix(buf) {
      var v = ctx.createBufferSource(), vg = ctx.createGain(); v.buffer = buf; vg.gain.value = 1.5;
      v.connect(vg); vg.connect(maitre); v.start(Math.max(ctx.currentTime, t0 + T.voix));
    }
    if (voixBuffer) jouerVoix(voixBuffer);
    else if (voixOctets) {
      ctx.decodeAudioData(voixOctets.slice(0), function (d) { voixBuffer = d; jouerVoix(d); }, function () {});
    }
    boum(t0 + T.phrase2, 0.8, 55, 24, 1.6);

    // 5) Note grave sous la phrase
    boum(t0 + T.phrase, 0.9, 60, 24, 2.2);
    var dr = ctx.createOscillator(), drg = ctx.createGain(), drf = ctx.createBiquadFilter();
    dr.type = 'sawtooth'; dr.frequency.value = 43.65; drf.type = 'lowpass'; drf.frequency.value = 220;
    drg.gain.setValueAtTime(0.0001, t0 + T.phrase); drg.gain.exponentialRampToValueAtTime(0.22, t0 + T.phrase + 0.4); drg.gain.exponentialRampToValueAtTime(0.0001, t0 + T.sortie + 0.5);
    dr.connect(drf); drf.connect(drg); drg.connect(maitre); dr.start(t0 + T.phrase); dr.stop(t0 + T.fin);

    function sub(t, vol, f, dur) {
      var o = ctx.createOscillator(), sh = ctx.createWaveShaper(), og = ctx.createGain(), lp = ctx.createBiquadFilter();
      var c = new Float32Array(256); for (var i = 0; i < 256; i++) { var x = i / 128 - 1; c[i] = Math.tanh(x * 3); } sh.curve = c;
      o.type = 'sine'; o.frequency.setValueAtTime(f * 1.6, t); o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
      lp.type = 'lowpass'; lp.frequency.value = 160;
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(vol, t + 0.015); og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(sh); sh.connect(lp); lp.connect(og); og.connect(maitre); o.start(t); o.stop(t + dur + 0.05);
    }
    function boum(t, vol, f1, f2, dur) {
      var o = ctx.createOscillator(), og = ctx.createGain(); o.type = 'sine';
      o.frequency.setValueAtTime(f1, t); o.frequency.exponentialRampToValueAtTime(f2, t + dur * 0.6);
      og.gain.setValueAtTime(0.0001, t); og.gain.exponentialRampToValueAtTime(vol, t + 0.012); og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(og); og.connect(maitre); o.start(t); o.stop(t + dur + 0.05);
      var c = ctx.createBufferSource(); c.buffer = bruit(ctx, 0.08);
      var cf = ctx.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 900;
      var cg = ctx.createGain(); cg.gain.setValueAtTime(vol * 0.5, t); cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      c.connect(cf); cf.connect(cg); cg.connect(maitre); c.start(t);
    }
  }

  /* ================= Spirale d'énergie (canvas) ================= */
  var cv = q('canvas'), cx = cv.getContext('2d'), W = 0, H = 0;
  function taille() { var dpr = Math.min(window.devicePixelRatio || 1, 2); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; cx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  window.addEventListener('resize', taille);
  function dessinerAttente() { cx.fillStyle = '#05080f'; cx.fillRect(0, 0, W, H); }

  var parts = [], etincelles = [];
  var VERT = [30, 235, 110], BLEU = [35, 110, 255], BLANC = [235, 255, 250]; // vert = Métha de la Rotte, bleu = Arraincourt Biogaz
  function melange(c, v) {
    var k = v > .7 ? (v - .7) / .3 : 0, f = .55 + .45 * Math.min(1, v / .7);
    return [c[0] * f + (BLANC[0] - c[0] * f) * k | 0, c[1] * f + (BLANC[1] - c[1] * f) * k | 0, c[2] * f + (BLANC[2] - c[2] * f) * k | 0];
  }
  function dessinerFeu(t, R, cxp, cyp) {
    var phase = t < T.implosion ? 'feu' : (t < T.impact ? 'implosion' : 'fini');
    var spin = 3 + t * 2.2;
    var k = phase === 'implosion' ? 1 - (t - T.implosion) / (T.impact - T.implosion) : 1;
    if (phase !== 'fini') {
      var n = phase === 'feu' ? 18 : 8;
      for (var i = 0; i < n; i++) {
        var bras = i % 4;
        parts.push({ a: bras * Math.PI / 2 + t * spin * 0.9 + (Math.random() - .5) * 0.5, r: R * (0.2 + Math.random() * 0.3), v: 1,
          w: spin * (0.8 + Math.random() * 0.4), s: R * (0.08 + Math.random() * 0.14), dr: R * (0.5 + Math.random() * 0.6), c: bras % 2 ? BLEU : VERT });
      }
    }
    cx.globalCompositeOperation = 'lighter';
    var hal = cx.createRadialGradient(cxp, cyp, 0, cxp, cyp, R * 2.4);
    hal.addColorStop(0, 'rgba(40,200,150,' + (0.22 * k) + ')'); hal.addColorStop(.45, 'rgba(40,140,255,' + (0.14 * k) + ')'); hal.addColorStop(1, 'rgba(20,80,200,0)');
    cx.fillStyle = hal; cx.fillRect(cxp - R * 2.5, cyp - R * 2.5, R * 5, R * 5);
    var dt = 1 / 60;
    for (var j = parts.length - 1; j >= 0; j--) {
      var p = parts[j];
      p.a += p.w * dt;
      if (phase !== 'feu') p.r *= 0.86; else p.r += p.dr * dt;
      p.v -= dt * 1.3;
      if (p.v <= 0 || p.r < 1) { parts.splice(j, 1); continue; }
      var x = cxp + Math.cos(p.a) * p.r, y = cyp + Math.sin(p.a) * p.r * 0.92;
      var c = melange(p.c, p.v), al = Math.min(1, p.v * 1.2) * 0.1, rr = p.s * (0.5 + p.v * 0.7);
      var gp = cx.createRadialGradient(x, y, 0, x, y, rr);
      gp.addColorStop(0, 'rgba(' + c + ',' + al + ')'); gp.addColorStop(1, 'rgba(' + c + ',0)');
      cx.fillStyle = gp; cx.beginPath(); cx.arc(x, y, rr, 0, Math.PI * 2); cx.fill();
    }
    if (phase !== 'fini') {
      var base = t * spin, longueur = phase === 'implosion' ? k : Math.min(1, 0.4 + t / 1.2);
      cx.lineCap = 'round';
      for (var bk = 0; bk < 4; bk++) {
        var pts = [], cb = bk % 2 ? BLEU : VERT, clair = [cb[0] * .55 + 110 | 0, cb[1] * .55 + 110 | 0, cb[2] * .55 + 110 | 0];
        for (var qq = 0; qq <= 34; qq++) {
          var u = qq / 34, rr2 = R * (0.22 + u * 1.5 * longueur);
          var aa = base + bk * Math.PI / 2 - u * 5.2 + Math.sin(t * 13 + qq * 0.6 + bk) * 0.05;
          pts.push([cxp + Math.cos(aa) * rr2, cyp + Math.sin(aa) * rr2 * 0.92, u]);
        }
        [[R * 0.34, 0.10, cb], [R * 0.16, 0.22, cb], [R * 0.06, 0.45, clair]].forEach(function (passe) {
          for (var m = 1; m < pts.length; m++) {
            var uu = pts[m][2], fond = Math.pow(1 - uu, 1.2);
            cx.strokeStyle = 'rgba(' + passe[2] + ',' + (passe[1] * fond) + ')';
            cx.lineWidth = Math.max(0.5, passe[0] * (1 - uu * 0.85));
            cx.beginPath(); cx.moveTo(pts[m - 1][0], pts[m - 1][1]); cx.lineTo(pts[m][0], pts[m][1]); cx.stroke();
          }
        });
      }
      var cr = R * (phase === 'implosion' ? 0.3 * k + 0.06 : 0.22 + Math.sin(t * 22) * 0.02);
      var gc = cx.createRadialGradient(cxp, cyp, 0, cxp, cyp, cr);
      gc.addColorStop(0, 'rgba(240,255,252,.95)'); gc.addColorStop(.5, 'rgba(120,240,220,.55)'); gc.addColorStop(1, 'rgba(56,182,255,0)');
      cx.fillStyle = gc; cx.beginPath(); cx.arc(cxp, cyp, cr, 0, Math.PI * 2); cx.fill();
    }
    cx.globalCompositeOperation = 'source-over';
  }
  function exploser(cxp, cyp, R) {
    for (var i = 0; i < 140; i++) {
      var a = Math.random() * Math.PI * 2, v = R * (2 + Math.random() * 7);
      etincelles.push({ x: cxp, y: cyp, vx: Math.cos(a) * v, vy: Math.sin(a) * v, v: 1, f: Math.random() < .5 });
    }
  }
  function dessinerEtincelles() {
    cx.globalCompositeOperation = 'lighter'; var dt = 1 / 60;
    for (var i = etincelles.length - 1; i >= 0; i--) {
      var e = etincelles[i]; e.vx *= 0.94; e.vy = e.vy * 0.94 + 30 * dt; e.x += e.vx * dt; e.y += e.vy * dt; e.v -= dt * 0.9;
      if (e.v <= 0) { etincelles.splice(i, 1); continue; }
      cx.strokeStyle = e.f ? 'rgba(56,182,255,' + e.v + ')' : 'rgba(34,227,161,' + e.v + ')';
      cx.lineWidth = 1.6; cx.beginPath(); cx.moveTo(e.x, e.y); cx.lineTo(e.x - e.vx * 0.04, e.y - e.vy * 0.04); cx.stroke();
    }
    cx.globalCompositeOperation = 'source-over';
  }
  function anneau(t, t1, cxp, cyp, R, rgb, duree, ampl) {
    var u = (t - t1) / duree; if (u < 0 || u > 1) return;
    var e = 1 - Math.pow(1 - u, 3);
    cx.strokeStyle = 'rgba(' + rgb + ',' + (1 - u) + ')'; cx.lineWidth = 3 * (1 - u) + 0.5;
    cx.beginPath(); cx.arc(cxp, cyp, R * (0.4 + e * ampl), 0, Math.PI * 2); cx.stroke();
  }

  /* ================= Texte qui se décode ================= */
  var GLYPHES = '█▓▒░<>/\\|=+*#01ΔΣΞ';
  function decoder(el, cible, u) {
    if (u <= 0) { el.textContent = ' '; return; }
    var n = Math.floor(cible.length * Math.min(1, u * 1.15)), s = '';
    for (var i = 0; i < cible.length; i++) s += i < n || cible[i] === ' ' ? cible[i] : GLYPHES[(Math.random() * GLYPHES.length) | 0];
    el.textContent = s;
  }

  /* ================= Lecture ================= */
  var raf = 0, enCours = false, t0 = 0, explose = false, brille = false, fini = false;
  function ease(x) { return x < 0 ? 0 : x > 1 ? 1 : 1 - Math.pow(1 - x, 3); }
  function clamp(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
  function coeur(t, tb) { return battement(t, tb, 0.26) + battement(t, tb + 0.3, 0.17); }
  function battement(t, tb, force) {
    var u = (t - tb) / 0.5; if (u < 0 || u > 1) return 0;
    var a = u < 0.12 ? u / 0.12 : 1 - (u - 0.12) / 0.88;
    return force * Math.pow(a, 1.4);
  }

  function lancer() {
    if (enCours || fini) return;
    try { sessionStorage.setItem('ix_vu', String(Date.now())); } catch (e) {}
    var porte = q('.ix-porte'); if (porte) porte.parentNode.removeChild(porte);
    try {
      AC = new (window.AudioContext || window.webkitAudioContext)(); AC.resume();
      programmerSons(AC.currentTime + 0.08);
    } catch (e) {}
    taille(); t0 = performance.now() + 80; enCours = true;
    raf = requestAnimationFrame(boucle);
  }

  function boucle(now) {
    if (!enCours) return;
    var t = Math.max(0, (now - t0) / 1000);
    var R = Math.min(W, H) * 0.19, cxp = W / 2, cyp = H * 0.46;
    cx.globalCompositeOperation = 'source-over'; cx.fillStyle = 'rgba(5,8,15,' + (t < T.impact ? 0.6 : 0.45) + ')'; cx.fillRect(0, 0, W, H);

    var tremble = t < T.impact ? clamp(t / T.impact) * 4 : 0;
    cx.save(); cx.translate((Math.random() - .5) * tremble, (Math.random() - .5) * tremble);
    if (t < T.impact + 0.3) dessinerFeu(t, R * (0.55 + 0.45 * ease(t / 1.4)), cxp, cyp);
    if (t >= T.impact && !explose) { explose = true; exploser(cxp, cyp, R); }
    dessinerEtincelles();
    anneau(t, T.impact, cxp, cyp, R, '34,227,161', 0.9, 4.5);
    anneau(t, T.impact + 0.08, cxp, cyp, R, '56,182,255', 1.1, 6);
    [T.coeur1, T.coeur1 + 0.3, T.coeur2, T.coeur2 + 0.3].forEach(function (tb, i) {
      anneau(t, tb, cxp, cyp, R * 1.7, i % 2 ? '56,182,255' : '34,227,161', 1.0, i % 2 ? 2.4 : 3.4);
    });
    anneau(t, T.phrase, cxp, cyp, R * 1.8, '56,225,255', 1.2, 2.5);
    cx.restore();

    q('.ix-flash').style.opacity = t >= T.impact ? Math.max(0, 1 - (t - T.impact) / 0.45) : (t > T.implosion ? 0.25 * clamp((t - T.implosion) / (T.impact - T.implosion)) : 0);
    q('.ix-hud').style.opacity = Math.min(1, t / 0.6) * (t > T.sortie ? Math.max(0, 1 - (t - T.sortie) / 0.5) : 1);
    q('.ix-grille').style.opacity = t > T.impact ? 0.9 * Math.min(1, (t - T.impact) / 0.6) : 0.25;
    q('.ix-chrono').textContent = 'T+' + (t < 10 ? '0' : '') + t.toFixed(2);
    q('.ix-etat').textContent = t < T.implosion ? 'Allumage' : t < T.coeur1 ? 'Fusion' : t < T.phrase ? 'Pulsation' : 'Prêt au combat';

    var pl = q('.ix-plaque');
    if (t >= T.impact) {
      var ua = ease((t - T.impact) / 0.35);
      var bat = coeur(t, T.coeur1) + coeur(t, T.coeur2);
      var echelle = 0.35 + 0.65 * ua + (1 - ua) * 0.5 * Math.sin(ua * Math.PI) + bat;
      pl.style.opacity = Math.min(1, ua * 1.5);
      pl.style.transform = 'scale(' + echelle.toFixed(4) + ')';
      pl.style.filter = 'blur(' + ((1 - ua) * 10).toFixed(1) + 'px) brightness(' + (1 + (1 - ua) * 1.5 + bat * 1.8).toFixed(2) + ') drop-shadow(0 0 ' + (8 + bat * 90).toFixed(0) + 'px rgba(34,227,161,' + Math.min(1, 0.45 + bat * 3).toFixed(2) + ')) drop-shadow(0 0 2px rgba(56,182,255,.8))';
      if (!brille && t > T.reflet) { brille = true; pl.classList.add('ix-brille'); }
    }

    var choc = coeur(t, T.coeur1) + coeur(t, T.coeur2), amp = choc * 60, centre = q('.ix-centre');
    centre.style.marginLeft = ((Math.random() - .5) * amp).toFixed(1) + 'px';
    centre.style.marginTop = ((Math.random() - .5) * amp).toFixed(1) + 'px';
    q('.ix-choc').style.opacity = Math.min(1, choc * 4).toFixed(2);

    if (t >= T.phrase) {
      q('.ix-phrase').style.opacity = 1;
      decoder(q('.ix-l1'), 'AGRIENERGIES', (t - T.phrase) / 0.9);
      decoder(q('.ix-l2'), 'ULTIMATE FIGHTING', (t - T.phrase2) / 0.7);
      q('.ix-trait').style.width = (ease((t - T.phrase) / 0.6) * 100) + '%';
    }

    if (t >= T.sortie) ix.style.opacity = 1 - clamp((t - T.sortie) / (T.fin - T.sortie));
    if (t >= T.fin) { terminer(); return; }
    raf = requestAnimationFrame(boucle);
  }

  function terminer() {
    if (fini) return;
    fini = true; enCours = false; cancelAnimationFrame(raf);
    try { if (AC) AC.close(); } catch (e) {}
    window.removeEventListener('resize', taille);
    document.body.style.overflow = ancienOverflow;
    if (ix.parentNode) ix.parentNode.removeChild(ix);
    if (st.parentNode) st.parentNode.removeChild(st);
  }

  var porte = q('.ix-porte');
  porte.addEventListener('click', lancer);
  porte.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lancer(); } });
  q('.ix-passer').addEventListener('click', function (e) {
    e.stopPropagation();
    try { sessionStorage.setItem('ix_vu', String(Date.now())); } catch (er) {}
    terminer();
  });

  if (document.body) monter(); else document.addEventListener('DOMContentLoaded', monter);
})();
