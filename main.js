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
  const INK = css.getPropertyValue('--text').trim() || '#0b1220';
  const W = innerWidth, H = innerHeight, small = W < 700;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement('canvas');
  cv.className = 'boot-canvas';
  cv.setAttribute('aria-hidden', 'true');
  cv.width = W * dpr; cv.height = H * dpr;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const clamp = (v) => Math.max(0, Math.min(1, v));
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const gauss = () => { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const hex = (c) => { const m = c.replace('#', ''); const n = parseInt(m.length === 3 ? m.replace(/./g, '$&$&') : m, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const ink = hex(INK);

  // the cloud: one soft Gaussian blob of points around the centre
  const N = small ? 4600 : 9500, cx = W / 2, cy = H / 2, sig = Math.min(W, H) * 0.17;
  // soft Gaussian splat sprites, one per colour step (6 levels per channel)
  const LV = 6, step = 255 / (LV - 1), SP = 40, sprites = [];
  for (let r = 0; r < LV; r++) for (let g = 0; g < LV; g++) for (let b = 0; b < LV; b++) {
    const c = document.createElement('canvas'); c.width = c.height = SP;
    const x = c.getContext('2d'), col = `${Math.round(r * step)},${Math.round(g * step)},${Math.round(b * step)}`;
    const gr = x.createRadialGradient(SP / 2, SP / 2, 0, SP / 2, SP / 2, SP / 2);
    gr.addColorStop(0, `rgba(${col},0.95)`); gr.addColorStop(0.4, `rgba(${col},0.6)`); gr.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, SP, SP); sprites.push(c);
  }
  const spriteOf = (c) => sprites[Math.round(c[0] / step) * LV * LV + Math.round(c[1] / step) * LV + Math.round(c[2] / step)];
  const pts = Array.from({ length: N }, () => {
    const gx = gauss() * sig, gy = gauss() * sig * 0.8;
    return { gx, gy, sp: 0.4 + Math.random() * 0.6, s: 0.8 + Math.random() * 1.1, tx: null, ty: null, c: ink, d: 0, bend: (Math.random() - 0.5) * 60 };
  });

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

  function assign() {
    let media, text;
    try { [media, text] = snapshot(); } catch (e) { media = text = null; }
    let tried = 0;
    const take = (data, want, tries) => {
      const out = []; tried = 0;
      if (!data) return out;
      for (let i = 0; i < tries && out.length < want; i++, tried++) {
        const x = (Math.random() * W) | 0, y = (Math.random() * H) | 0, o = (y * W + x) * 4;
        if (data[o + 3] > 90) out.push([x + Math.random(), y + Math.random(), [data[o], data[o + 1], data[o + 2]]]);
      }
      return out;
    };
    const tText = take(text, Math.round(N * 0.22), N * 140).map((t) => t.concat(1.3));
    const tMedia = take(media, N - tText.length, N * 30);
    // splat size: big enough that the splats cover the pictures, like Gaussian splats
    const area = tried ? (tMedia.length / tried) * W * H : 0;
    const base = tMedia.length ? Math.max(4, Math.min(22, Math.sqrt(area / tMedia.length) * 1.9)) : 4;
    const targets = tMedia.map((t) => t.concat(base * (0.55 + Math.random() * 0.9))).concat(tText);
    pts.forEach((p, i) => {
      const t = targets[i];
      if (!t) { p.tx = null; return; }
      [p.tx, p.ty, p.c, p.ts] = t;
      p.d = (p.ty / H) * 360 + Math.random() * 140;   // the page builds from top to bottom, like a scan
    });
  }

  // keep looping videos still while the page is rebuilt, so the points match what's underneath
  const held = [...document.querySelectorAll('video[autoplay]')];
  held.forEach((v) => { v.pause(); v.addEventListener('play', v._hold = () => v.pause()); });
  // posters for videos that are not ready yet, and wait (briefly) for images
  const waits = [];
  document.querySelectorAll('video[poster]').forEach((v) => { const im = new Image(); im.src = v.poster; v._poster = im; waits.push(im.decode().catch(() => {})); });
  document.querySelectorAll('img').forEach((im) => { if (!im.complete) waits.push(im.decode().catch(() => {})); });
  let ready = false, tReady = 0;
  const go = () => { if (ready) return; assign(); ready = true; tReady = performance.now(); };
  Promise.all(waits).then(go);
  setTimeout(go, 900);

  const FLY = 680, HOLD = 140, FADE = 480, MIN_CLOUD = 480;
  const t0 = performance.now();
  let first = true;
  function frame(now) {
    const t = now - t0;
    const tf = ready ? now - Math.max(tReady, t0 + MIN_CLOUD) : -1;
    const done = 360 + 140 + FLY + HOLD;
    const fade = tf > done ? clamp((tf - done) / FADE) : 0;
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 1 - easeIO(fade);
    ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
    const rot = t * 0.00035, cr = Math.cos(rot), sr = Math.sin(rot);
    const appear = clamp(t / 300);
    for (const p of pts) {
      // where the point sits in the cloud (slowly turning)
      const ax = cx + (p.gx * cr - p.gy * sr) * (0.92 + 0.08 * Math.sin(t * 0.002 * p.sp));
      const ay = cy + (p.gx * sr + p.gy * cr);
      let x = ax, y = ay, c = ink, a = 0.55 * appear, size = p.s;
      if (tf > 0 && p.tx !== null) {
        const q = easeIO(clamp((tf - p.d) / FLY));
        const bend = Math.sin(Math.PI * q) * p.bend;
        x = ax + (p.tx - ax) * q + bend; y = ay + (p.ty - ay) * q;
        c = [0, 1, 2].map((k) => Math.round(ink[k] + (p.c[k] - ink[k]) * q));
        size = p.s + (p.ts - p.s) * q;
        a = p.ts > 2 ? 0.55 + 0.35 * q : 0.55 + 0.4 * q;
      } else if (tf > 0) {
        a *= 1 - clamp(tf / 400);
      }
      a *= 1 - easeIO(fade);
      if (a < 0.02) continue;
      ctx.globalAlpha = a;
      if (size > 2.6) ctx.drawImage(spriteOf(c), x - size / 2, y - size / 2, size, size);
      else { ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(x - size / 2, y - size / 2, size, size); }
    }
    ctx.globalAlpha = 1;
    if (first) { first = false; root.classList.remove('boot'); }
    if (fade < 1) requestAnimationFrame(frame);
    else {
      cv.remove(); root.classList.remove('booting');
      held.forEach((v) => { v.removeEventListener('play', v._hold); v.play().catch(() => {}); });
    }
  }
  requestAnimationFrame(frame);
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
