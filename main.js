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
// Loader: on first visit or refresh, a fine splatter streams into one dot,
// which opens like an aperture and reveals the page. Skipped when arriving
// from another page on the site, going back, or with "reduce motion".
// ---------------------------------------------------------------------------
(function bootLoader() {
  const root = document.documentElement;
  if (!root.classList.contains('boot')) return;
  const css = getComputedStyle(root);
  const BG = css.getPropertyValue('--bg').trim() || '#f7f8fa';
  const INK = css.getPropertyValue('--text').trim() || '#0b1220';

  const cv = document.createElement('canvas');
  cv.className = 'boot-canvas';
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let W = innerWidth, H = innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const clamp = (v) => Math.max(0, Math.min(1, v));
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeIO4 = (t) => (t < 0.5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2);
  const cx = W / 2, cy = H / 2, M = Math.min(W, H);
  const N = W < 700 ? 420 : 900;
  const parts = Array.from({ length: N }, () => ({
    r0: M * (0.28 + Math.random() * 0.55),
    a0: Math.random() * Math.PI * 2,
    d: Math.random() * 360,
    dur: 820 + Math.random() * 380,
  }));
  const at = (p, q) => {
    const r = p.r0 * Math.pow(1 - q, 1.25), a = p.a0 + q * 1.7;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const DOT = 6.5, T_DOT = 720, T_OPEN = 1260, T_END = 1960;
  const diag = Math.hypot(W, H) / 2 + 24;
  let first = true;
  const t0 = performance.now();

  function frame(now) {
    const t = now - t0;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    // streams: each particle is a short streak along an inward spiral
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.6;
    ctx.lineCap = 'round';
    for (let b = 0; b < 4; b++) {
      ctx.globalAlpha = 0.12 + b * 0.12;
      ctx.beginPath();
      for (const p of parts) {
        const q = easeIO(clamp((t - p.d) / p.dur));
        if (q <= 0 || q >= 0.97) continue;
        const bucket = Math.min(3, Math.floor(Math.sin(Math.PI * q) * 4));
        if (bucket !== b) continue;
        const [x1, y1] = at(p, Math.max(0, q - 0.05));
        const [x2, y2] = at(p, q);
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // the dot: settles with a soft spring, like a drop finding its shape
    const tau = t - T_DOT;
    let r = tau > 0 ? DOT * (1 - Math.exp(-tau / 110) * Math.cos(tau / 75)) : 0;
    const open = easeIO4(clamp((t - T_OPEN) / (T_END - T_OPEN - 60)));
    if (open > 0) {
      const R = r + open * diag;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.5 * (1 - open);
      ctx.strokeStyle = INK; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1 - clamp((t - T_OPEN) / 90);
      r = Math.max(0, r * (1 - open * 4));
    }
    if (r > 0.2) { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;

    if (first) { first = false; root.classList.remove('boot'); }
    if (t < T_END) requestAnimationFrame(frame);
    else { cv.remove(); root.classList.remove('booting'); }
  }
  root.classList.add('booting');
  requestAnimationFrame(frame);
})();

// ---------------------------------------------------------------------------
// Cursor HUD: brackets snap to whatever you point at, with a small live label.
// Desktop with a mouse only; off with "reduce motion". The real cursor stays.
// ---------------------------------------------------------------------------
(function cursorHud() {
  if (reduceMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const hud = document.createElement('div');
  hud.className = 'hud';
  hud.setAttribute('aria-hidden', 'true');
  hud.innerHTML = '<svg class="hud__svg"><path class="hud__lead"/><g class="hud__trail"/></svg>' +
    '<div class="hud__br"><i></i><i></i><i></i><i></i></div>' +
    '<div class="hud__chip"><b><em></em><span class="hud__lab"></span></b><span class="hud__xy"></span><span class="hud__act"></span></div>';
  document.body.appendChild(hud);
  const br = hud.querySelector('.hud__br'), chip = hud.querySelector('.hud__chip');
  const lab = hud.querySelector('.hud__lab'), xy = hud.querySelector('.hud__xy'), act = hud.querySelector('.hud__act');
  const em = hud.querySelector('em'), lead = hud.querySelector('.hud__lead'), trailG = hud.querySelector('.hud__trail');

  const TARGETS = 'a, button, input, textarea, [data-youtube], [data-hud]';
  const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
  const short = (s, n = 30) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  function describe(el) {
    if (el.dataset.hud) return [el.dataset.hud, el.dataset.hudAct || ''];
    if (el.classList.contains('tile')) return ['Project · ' + text(el.querySelector('.tile__label') || el), 'Open case study'];
    if (el.classList.contains('next')) return ['Next · ' + text(el.querySelector('.next__title') || el), 'Open project'];
    if (el.dataset.youtube !== undefined) return ['Video · Demo', 'Play'];
    if (el.dataset.themeSet) return ['Theme · ' + text(el), 'Switch'];
    if (el.matches('input, textarea')) return ['Field · ' + (el.name || el.id || 'text'), 'Type'];
    if (el.tagName === 'BUTTON') return ['Button · ' + short(text(el), 22), el.type === 'submit' ? 'Send' : ''];
    const href = el.getAttribute('href') || '';
    if (href === './' || href === 'index.html') return ['Home', 'Open'];
    if (href.startsWith('mailto:')) return ['Email · ' + href.slice(7), 'Write email'];
    if (/^https?:/.test(href)) { let host = href; try { host = new URL(href).hostname.replace(/^www\./, ''); } catch (e) {} return ['Link · ' + host, 'Open in new tab']; }
    if (el.classList.contains('nav__item')) return ['Page · ' + text(el), 'Open'];
    return ['Link · ' + short(text(el), 22), 'Open'];
  }

  // Text-only links can sit in wide grid cells: bracket the words, not the whole cell.
  function rectOf(el) {
    if (!el.querySelector('img, video, svg, iframe, canvas') && !el.matches('input, textarea') && text(el)) {
      const r = document.createRange(); r.selectNodeContents(el);
      const b = r.getBoundingClientRect(); if (b.width) return b;
    }
    return el.getBoundingClientRect();
  }

  let mx = -100, my = -100, tgt = null, since = 0, typed = '', lastPush = 0, shown = false;
  const B = { x: 0, y: 0, w: 0, h: 0 }, C = { x: 0, y: 0 }, trail = [];
  let info = ['', ''];
  addEventListener('pointermove', (e) => {
    mx = e.clientX; my = e.clientY;
    const el = e.target.closest && e.target.closest(TARGETS);
    if (el !== tgt) {
      if (el && !tgt) { Object.assign(B, { x: mx - 10, y: my - 10, w: 20, h: 20 }); Object.assign(C, { x: mx + 24, y: my + 22 }); trail.length = 0; }
      tgt = el; since = performance.now(); typed = ''; info = el ? describe(el) : info;
    }
  }, { passive: true });
  document.addEventListener('pointerleave', () => { tgt = null; });
  addEventListener('pagehide', () => { tgt = null; hud.classList.remove('is-on'); });

  function loop(now) {
    const busy = document.documentElement.classList.contains('booting') || document.body.classList.contains('is-leaving');
    const on = !!tgt && !busy && tgt.isConnected;
    if (on !== shown) { shown = on; hud.classList.toggle('is-on', on); }
    if (on) {
      const e = rectOf(tgt);
      const T = { x: e.left - 6, y: e.top - 6, w: e.width + 12, h: e.height + 12 };
      for (const k of ['x', 'y', 'w', 'h']) B[k] += (T[k] - B[k]) * 0.22;
      br.style.transform = `translate(${B.x}px, ${B.y}px)`;
      br.style.width = B.w + 'px'; br.style.height = B.h + 'px';
      const tx = Math.min(mx + 24, innerWidth - 240), ty = Math.min(my + 22, innerHeight - 64);
      C.x += (tx - C.x) * 0.25; C.y += (ty - C.y) * 0.25;
      chip.style.transform = `translate(${C.x}px, ${C.y}px)`;
      lead.setAttribute('d', `M${mx} ${my} L${mx + 8} ${my + 10} L${C.x} ${C.y + 9}`);
      lab.textContent = short(info[0], 34);
      xy.textContent = `X.${String(Math.round(Math.max(0, Math.min(1, mx / innerWidth)) * 999)).padStart(3, '0')} Y.${String(Math.round(Math.max(0, Math.min(1, my / innerHeight)) * 999)).padStart(3, '0')}`;
      const a = info[1];
      em.classList.toggle('is-act', !!a);
      if (a && now - since > 420 && typed.length < a.length + 2) typed = ('▸ ' + a).slice(0, typed.length + 1);
      act.textContent = a ? typed : '';
      if (now - lastPush > 130) { trail.push([mx, my]); if (trail.length > 4) trail.shift(); lastPush = now; }
      trailG.innerHTML = trail.map(([x, y], i) => {
        const o = ((i + 1) / trail.length) * 0.5;
        return `<line x1="${x}" y1="${y}" x2="${mx}" y2="${my}" style="opacity:${o * 0.6}"/><rect x="${x - 2.5}" y="${y - 2.5}" width="5" height="5" style="opacity:${o}"/>`;
      }).join('');
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
