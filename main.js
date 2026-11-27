document.documentElement.classList.add('js');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Respect "reduce motion": show the still poster instead of looping videos.
if (reduceMotion) {
  document.querySelectorAll('video[autoplay]').forEach((v) => {
    v.removeAttribute('autoplay');
    v.pause();
  });
}

// YouTube embeds: load the player only when needed (faster page, no tracking until then).
// - Click: plays with sound.
// - Scrolled into view: starts muted (browsers only allow muted autoplay),
//   pauses when scrolled away and resumes when it comes back.
function loadYouTube(el, { muted }) {
  if (el.classList.contains('is-playing')) return el.querySelector('iframe');
  const params = new URLSearchParams({
    autoplay: '1',
    mute: muted ? '1' : '0',
    playsinline: '1',
    rel: '0',
    enablejsapi: '1',
  });
  if (el.dataset.start) params.set('start', el.dataset.start);
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${el.dataset.youtube}?${params}`;
  iframe.title = el.getAttribute('aria-label') || 'Video';
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  el.replaceChildren(iframe);
  el.classList.add('is-playing');
  return iframe;
}

function command(iframe, func) {
  iframe?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args: [] }), '*');
}

document.querySelectorAll('[data-youtube]').forEach((el) => {
  el.addEventListener('click', () => loadYouTube(el, { muted: false }), { once: true });

  if (reduceMotion || !('IntersectionObserver' in window)) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const iframe = el.querySelector('iframe');
      if (entry.isIntersecting) {
        if (iframe) command(iframe, 'playVideo');
        else loadYouTube(el, { muted: true });
      } else if (iframe) {
        command(iframe, 'pauseVideo');
      }
    });
  }, { threshold: 0.5 });

  observer.observe(el);
});

// Card -> case page: carry the video's playback position across, so the
// morphing frame shows one continuous shot instead of restarting.
const featureTile = document.querySelector('.tile--feature');
// The Workspace Advisor card shows its still frame, and plays only while you hover it.
if (featureTile && !reduceMotion) {
  const v = featureTile.querySelector('video');
  if (v) {
    featureTile.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') v.play().catch(() => {}); });
    featureTile.addEventListener('pointerleave', () => v.pause());
    featureTile.addEventListener('focus', () => v.play().catch(() => {}));
    featureTile.addEventListener('blur', () => v.pause());
  }
}
if (featureTile) {
  featureTile.addEventListener('click', () => {
    const v = featureTile.querySelector('video');
    try { if (v) sessionStorage.setItem('advisorVideoTime', String(v.currentTime)); } catch (e) {}
  });
}
const heroVideo = document.querySelector('.cs__hero video');
if (heroVideo) {
  let t = null;
  try { t = sessionStorage.getItem('advisorVideoTime'); sessionStorage.removeItem('advisorVideoTime'); } catch (e) {}
  if (t !== null) {
    const seek = () => { heroVideo.currentTime = parseFloat(t) || 0; };
    if (heroVideo.readyState >= 1) seek(); else heroVideo.addEventListener('loadedmetadata', seek, { once: true });
  }
}


// Case page: wipe-reveal each image as it scrolls into view (once).
// We watch the frame's parent: a fully clipped element doesn't count as visible.
const revealEls = document.querySelectorAll('.cs__body .cs__frame');
if (revealEls.length && 'IntersectionObserver' in window && !reduceMotion) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.__revealTargets.forEach((el) => el.classList.add('is-in'));
      io.unobserve(e.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -12% 0px' });
  revealEls.forEach((el) => {
    el.classList.add('reveal');
    const watch = el.closest('figure') || el.parentElement;
    (watch.__revealTargets ||= []).push(el);
    io.observe(watch);
  });
}


// Theme switch: Light / Dark / System (follows the device). Saved per browser.
// Re-checked whenever a page is shown, so pages restored by Back/Forward
// (which skip reloading) and other open tabs always match the saved choice.
function savedTheme() {
  try { return localStorage.getItem('theme') || 'system'; } catch (e) { return 'system'; }
}
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('[data-theme-set]').forEach((b) =>
    b.setAttribute('aria-pressed', String(b.dataset.themeSet === t)));
}
document.querySelectorAll('[data-theme-set]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const t = btn.dataset.themeSet;
    try { localStorage.setItem('theme', t); } catch (e) {}
    applyTheme(t);
  });
});
applyTheme(savedTheme());
window.addEventListener('pageshow', () => applyTheme(savedTheme()));
window.addEventListener('storage', (e) => { if (e.key === 'theme') applyTheme(savedTheme()); });


// Micro-motion: [data-roll] groups roll their children in, in order, once visible.
const rollEls = document.querySelectorAll('[data-roll]');
if (rollEls.length && 'IntersectionObserver' in window && !reduceMotion) {
  const rio = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('is-in');
      rio.unobserve(e.target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -10% 0px' });
  rollEls.forEach((el) => {
    [...el.children].forEach((c, i) => c.style.setProperty('--i', i));
    if (el.dataset.rollDelay) el.style.setProperty('--roll-delay', el.dataset.rollDelay + 'ms');
    rio.observe(el);
  });
} else {
  rollEls.forEach((el) => el.classList.add('is-in'));
}


// Story scrolling (case page): after you stop scrolling, if a chapter is close
// to the centre, the page eases it into place slowly (no fast browser snap).
// Any wheel, touch, key or click during the glide hands control straight back.
(() => {
  const b = document.body.classList;
  if (!b.contains('is-case') || b.contains('is-about') || b.contains('is-contact') || reduceMotion) return;
  const desktop = window.matchMedia('(min-width: 801px) and (min-height: 600px) and (hover: hover) and (pointer: fine)');
  const rect = (sel) => {
    const els = [...document.querySelectorAll(sel)];
    if (!els.length) return null;
    const rs = els.map((e) => e.getBoundingClientRect());
    return { top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) };
  };
  // Each stop returns the scrollY that centres that chapter's content.
  const centre = (r) => r && scrollY + (r.top + r.bottom) / 2 - innerHeight / 2;
  const stops = () => [
    0, // the page as it opens
    centre((() => { const a = rect('.cs__facts'), b = rect('.cs__statement--hmw .cs__big'); return a && b && { top: a.top, bottom: b.bottom }; })()),
    centre(rect('.cs__duo .cs__frame')),
    centre(rect('.cs__trio .cs__frame')),
    centre((() => { const r = rect('.cs__learnings'); return r && (r.bottom - r.top) < innerHeight * 0.8 ? r : null; })()),
    centre(rect('.cs__body > .cs__shot .cs__frame')),
  ].filter((y) => y !== null && y !== undefined);

  let idle, anim, gliding = false;
  const ease = (t) => 1 - Math.pow(1 - t, 3); // soft ease-out, like the rest of the site
  const stopGlide = () => { if (anim) cancelAnimationFrame(anim); anim = null; gliding = false; };

  function glideTo(target) {
    const from = scrollY, dist = target - from;
    const dur = Math.min(900, 450 + Math.abs(dist) * 1.2); // slower for longer moves
    const t0 = performance.now();
    gliding = true;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      window.scrollTo(0, from + dist * ease(t));
      if (t < 1) anim = requestAnimationFrame(step); else stopGlide();
    };
    anim = requestAnimationFrame(step);
  }

  function settle() {
    if (!desktop.matches) return;
    const y = scrollY;
    let best = null;
    for (const s of stops()) if (best === null || Math.abs(s - y) < Math.abs(best - y)) best = s;
    const d = Math.abs(best - y);
    // only help when you're already close (within a fifth of the screen), never yank
    if (d > 3 && d < innerHeight * 0.2) glideTo(Math.max(0, best));
  }

  window.addEventListener('scroll', () => {
    if (gliding) return;
    clearTimeout(idle);
    idle = setTimeout(settle, 220); // wait until trackpad momentum has fully ended
  }, { passive: true });
  ['wheel', 'touchstart', 'keydown', 'mousedown'].forEach((ev) =>
    window.addEventListener(ev, () => { if (gliding) stopGlide(); clearTimeout(idle); }, { passive: true }));
})();

// Landing: when a project is opened, fade the other cards out first.
document.querySelectorAll('.is-landing .tile[href$=".html"]').forEach((tile) => {
  tile.addEventListener('click', (e) => {
    if (reduceMotion || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    tile.classList.add('is-chosen');
    document.body.classList.add('is-leaving');
    setTimeout(() => { location.href = tile.href; }, 300);
  });
});
// Coming back (Back button restores the page from memory): show all cards again.
window.addEventListener('pageshow', () => {
  document.body.classList.remove('is-leaving');
  document.querySelectorAll('.tile.is-chosen').forEach((t) => t.classList.remove('is-chosen'));
});

// Contact form: no server needed. Validates, then opens the visitor's email app
// with the message pre-filled, addressed to the email shown on the page.
const contactForm = document.querySelector('.contact__form');
if (contactForm) {
  const to = document.querySelector('[data-email]')?.textContent.trim();
  const hint = contactForm.querySelector('.contact__hint');
  contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    let ok = true;
    contactForm.querySelectorAll('input, textarea').forEach((f) => {
      const bad = !f.checkValidity() || !f.value.trim();
      f.closest('.field').classList.toggle('is-invalid', bad);
      if (bad) ok = false;
    });
    if (!ok) { hint.textContent = 'Please fill in all three fields.'; return; }
    const d = new FormData(contactForm);
    const subject = `Portfolio: message from ${d.get('name')}`;
    const body = `${d.get('message')}\n\n${d.get('name')}\n${d.get('email')}`;
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    hint.textContent = `If nothing opened, email me directly at ${to}.`;
  });
}


// Line-by-line rise for statements and page headlines.
// Words are grouped into the lines the browser actually draws, then each line rises from a mask.
(() => {
  const els = document.querySelectorAll('.cs__big, .about__title, .contact__title, .next__title');
  if (!els.length || reduceMotion || !('IntersectionObserver' in window)) return;
  const build = (el) => {
    const text = el.dataset.text || el.textContent.trim();
    el.dataset.text = text;
    el.setAttribute('aria-label', text);
    el.innerHTML = text.split(/\s+/).map((w) => `<span class="w" aria-hidden="true">${w}</span>`).join(' ');
    const lines = [];
    let top = null;
    el.querySelectorAll('.w').forEach((w) => {
      const t = w.offsetTop;
      if (top === null || Math.abs(t - top) > 4) { lines.push([]); top = t; }
      lines[lines.length - 1].push(w.textContent);
    });
    el.innerHTML = lines.map((l, i) => `<span class="line" aria-hidden="true" style="--l:${i}"><span>${l.join(' ')}</span></span>`).join('');
  };
  els.forEach((el) => {
    el.classList.add('rise');
    build(el);
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      if (e.isIntersecting) { el.classList.add('is-in'); io.disconnect(); }
    }), { rootMargin: el.classList.contains('next__title') ? '0px' : '0px 0px -10% 0px' });
    io.observe(el);
  });
  let w = innerWidth;
  addEventListener('resize', () => {
    if (Math.abs(innerWidth - w) < 40) return; w = innerWidth;
    els.forEach((el) => { const done = el.classList.contains('is-in'); build(el); if (done) el.classList.add('is-in'); });
  });
})();

// Mark moves between pages on this site, so the loader only plays on a fresh
// visit or a refresh (read by the small script in each page's <head>).
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey) return;
  try {
    const u = new URL(a.href, location.href);
    if (u.origin === location.origin && /\.html$|\/$/.test(u.pathname)) sessionStorage.setItem('hzInternal', '1');
  } catch (err) {}
}, true);

// ---------------------------------------------------------------------------
// Loader: the page is rebuilt from a point cloud. A soft Gaussian cloud of
// points gathers, then each point flies to a pixel of the real page (images,
// text, panels), takes its colour, and the cloud dissolves into the page.
// First visit or refresh only; skipped between pages, on back, and with
// "reduce motion".
// ---------------------------------------------------------------------------
(function splatLoader() {
  const root = document.documentElement;
  if (!root.classList.contains('boot')) return;
  root.classList.add('booting');
  const css = getComputedStyle(root);
  const BG = css.getPropertyValue('--bg').trim() || '#f7f8fa';
  const W = innerWidth, H = innerHeight, small = W < 700;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.className = 'boot-canvas';
  cv.setAttribute('aria-hidden', 'true');
  cv.width = W * dpr; cv.height = H * dpr;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);

  const clamp = (v) => Math.max(0, Math.min(1, v));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIO = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

  // a snapshot of the page as it will look, drawn into an offscreen canvas
  function snapshot() {
    const sc = document.createElement('canvas'); sc.width = W; sc.height = H;
    const sx = sc.getContext('2d', { willReadFrequently: true });
    const tc = document.createElement('canvas'); tc.width = W; tc.height = H;
    const tx = tc.getContext('2d', { willReadFrequently: true });
    const inView = (r) => r.width > 2 && r.height > 2 && r.bottom > 0 && r.top < H && r.right > 0 && r.left < W;
    // panels and media
    document.querySelectorAll('.tile__media, .cs__hero, .cs__frame').forEach((box) => {
      const r = box.getBoundingClientRect(); if (!inView(r)) return;
      const bg = getComputedStyle(box).backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)') { sx.fillStyle = bg; sx.fillRect(r.left, r.top, r.width, r.height); }
    });
    document.querySelectorAll('img, video').forEach((m) => {
      const r = m.getBoundingClientRect(); if (!inView(r)) return;
      let src = m;
      if (m.tagName === 'VIDEO') { if (m.readyState < 2) { src = m._poster; if (!src) return; } }
      else if (!m.complete || !m.naturalWidth) return;
      const iw = src.videoWidth || src.naturalWidth, ih = src.videoHeight || src.naturalHeight; if (!iw) return;
      const st = getComputedStyle(m), fit = st.objectFit;
      const k = fit === 'contain' ? Math.min(r.width / iw, r.height / ih) : Math.max(r.width / iw, r.height / ih);
      const dw = iw * k, dh = ih * k;
      const [px, py] = (st.objectPosition || '50% 50%').split(' ').map((v) => (v.endsWith('%') ? parseFloat(v) / 100 : v === 'right' || v === 'bottom' ? 1 : v === 'left' || v === 'top' ? 0 : 0.5));
      const clip = m.closest('.tile__media, .cs__hero, .cs__frame')?.getBoundingClientRect() || r;
      sx.save(); sx.beginPath(); sx.rect(clip.left, clip.top, clip.width, clip.height); sx.clip();
      try { sx.drawImage(src, r.left + (r.width - dw) * px, r.top + (r.height - dh) * (py ?? 0.5), dw, dh); } catch (e) {}
      sx.restore();
    });
    // text, word by word, in its real font and colour
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() && !n.parentElement.closest('script, style, .boot-canvas') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    const range = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement, st = getComputedStyle(el);
      if (st.visibility === 'hidden' || st.display === 'none') continue;
      tx.font = `${st.fontStyle} ${st.fontWeight} ${st.fontSize} ${st.fontFamily}`;
      tx.fillStyle = st.color.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, 'rgb($1,$2,$3)');
      tx.textBaseline = 'middle';
      const re = /\S+/g; let m;
      while ((m = re.exec(n.nodeValue))) {
        range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
        const b = range.getBoundingClientRect(); if (!inView(b)) continue;
        tx.fillText(m[0], b.left, b.top + b.height / 2);
      }
    }
    return [sx.getImageData(0, 0, W, H).data, tx.getImageData(0, 0, W, H).data];
  }

  // pick points on what's actually drawn: scan every 2nd pixel once, then sample
  function sample(data, want) {
    if (!data || want <= 0) return [];
    const hits = [];
    for (let y = 0; y < H; y += 2) for (let x = (y >> 1) & 1; x < W; x += 2) { const o = (y * W + x) * 4; if (data[o + 3] > 90) hits.push(o >> 2); }
    const out = [];
    for (let i = 0; i < want && hits.length; i++) {
      const k = hits[(Math.random() * hits.length) | 0], o = k * 4;
      // quantise the colour a little, so neighbouring points share one fill style
      const q = (v) => (v >> 3) << 3;
      out.push([(k % W) + Math.random(), ((k / W) | 0) + Math.random(), `rgb(${q(data[o])},${q(data[o + 1])},${q(data[o + 2])})`]);
    }
    return out;
  }

  // keep looping videos still while the page forms, so the points match what's underneath
  const held = [...document.querySelectorAll('video[autoplay]')];
  held.forEach((v) => { v.pause(); v.addEventListener('play', v._hold = () => v.pause()); });
  const waits = [];
  document.querySelectorAll('video[poster]').forEach((v) => { const im = new Image(); im.src = v.poster; v._poster = im; waits.push(im.decode().catch(() => {})); });
  document.querySelectorAll('img').forEach((im) => { if (!im.complete) waits.push(im.decode().catch(() => {})); });

  const N = small ? 5000 : 10000;
  const spread = Math.min(W, H) * 0.06;
  let pts = null, t0 = 0;
  function build() {
    let media = null, text = null;
    try { [media, text] = snapshot(); } catch (e) {}
    const tText = sample(text, Math.round(N * 0.25)).map((p) => p.concat(1));
    const tMedia = sample(media, N - tText.length).map((p) => p.concat(1.1 + Math.random() * 0.9));
    pts = tMedia.concat(tText).map(([tx, ty, c, s]) => ({
      tx, ty, c, s,
      // each point starts a little above and around its spot, and drifts in
      ox: gauss() * spread, oy: gauss() * spread * 0.7 - spread * 0.9,
      d: (ty / H) * 520 + Math.random() * 260,     // a soft wave from top to bottom
    }));
    pts.sort((a, b) => (a.c < b.c ? -1 : a.c > b.c ? 1 : 0));
    t0 = performance.now();
    requestAnimationFrame(frame);
  }
  let started = false;
  const start = () => { if (started) return; started = true; requestAnimationFrame(build); };
  Promise.all(waits).then(start);
  setTimeout(start, 700);

  const TRAVEL = 880, FADE_AT = 1400, FADE = 560;
  let first = true;
  function frame(now) {
    const t = now - t0;
    const fade = easeIO(clamp((t - FADE_AT) / FADE));
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 1 - fade;
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    let cur = '';
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = clamp((t - p.d) / TRAVEL);
      if (q <= 0) continue;
      const e = easeOut(q), inv = 1 - e;
      const a = Math.min(1, q * 2.2) * 0.9 * (1 - fade);
      if (a < 0.02) continue;
      if (p.c !== cur) { cur = p.c; ctx.fillStyle = cur; }
      ctx.globalAlpha = a;
      ctx.fillRect(p.tx + p.ox * inv - p.s / 2, p.ty + p.oy * inv - p.s / 2, p.s, p.s);
    }
    ctx.globalAlpha = 1;
    if (first) { first = false; root.classList.remove('boot'); }
    if (fade < 1) requestAnimationFrame(frame);
    else {
      cv.remove(); root.classList.remove('booting');
      held.forEach((v) => { v.removeEventListener('play', v._hold); v.play().catch(() => {}); });
    }
  }
  // the static cover in CSS stays until the first frame, so nothing flashes
})();

// ---------------------------------------------------------------------------
// Cards with depth (landing): a card tilts gently toward the cursor, its label
// floats a little above it, and the picture shifts inside the frame.
// Desktop with a mouse only; off with "reduce motion".
// ---------------------------------------------------------------------------
(function depthCards() {
  if (reduceMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  document.querySelectorAll('.is-landing .tile').forEach((tile) => {
    const media = tile.querySelector('.tile__media');
    const pic = media && media.querySelector('img, video');
    if (!media) return;
    const shine = document.createElement('span');
    shine.className = 'tile__shine';
    media.appendChild(shine);
    tile.addEventListener('pointermove', (e) => {
      if (document.body.classList.contains('is-leaving')) return;
      const r = tile.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      tile.classList.add('is-tilting');
      tile.style.transform = `perspective(1100px) translateY(-8px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg)`;
      if (pic) pic.style.transform = `scale(1.06) translate(${(-x * 12).toFixed(1)}px, ${(-y * 8).toFixed(1)}px)`;
      media.style.setProperty('--sx', `${((x + 0.5) * 100).toFixed(1)}%`);
      media.style.setProperty('--sy', `${((y + 0.5) * 100).toFixed(1)}%`);
    });
    const reset = () => { tile.classList.remove('is-tilting'); tile.style.transform = ''; if (pic) pic.style.transform = ''; };
    tile.addEventListener('pointerleave', reset);
    tile.addEventListener('click', reset);
  });
})();
