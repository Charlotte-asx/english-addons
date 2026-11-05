/*
 * Tur — SeriesTurcasTV (kaj.seriesturcastv.to)
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * Flujo de servidores: capítulo → enlace a esprinahy.com → URLs reales de tokvoy.com (_h = HD, _n = Normal).
 * ES5. Usa [\s\S] en vez de . con la bandera s.
 */

var BASE = (CONFIG.base || "https://kaj.seriesturcastv.to").replace(/\/+$/, "");
var BASE_RE = BASE.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&");

function clean(s) { return util.htmlDecode(String(s || "")).replace(/^\s+|\s+$/g, ""); }

function get(url, headers) {
  var h = http.get(url, headers);
  if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
  return h;
}

function epNum(title) {
  var m, last = -1, re = /(\d+)/g;
  while ((m = re.exec(String(title || ""))) !== null) last = parseInt(m[1], 10);
  return last;
}

// ───────────── Cards ─────────────
function parseCards(html) {
  var out = [], seen = {}, m;
  var blockRe = /<a\s+[^>]*class="poster"[^>]*>([\s\S]*?)<\/a>/g;
  while ((m = blockRe.exec(html)) !== null) {
    var tag = m[0], block = m[1];
    var h = new RegExp("href=\"(" + BASE_RE + "\\/[^\"]+)\"").exec(tag);
    if (!h) continue;
    var url = h[1];
    var t = /title="([^"]*)"/.exec(tag);
    var title = t ? clean(t[1]) : "";
    var i = /<img\s+[^>]*src="([^"]+)"/.exec(block);
    if (!i) continue;
    if (seen[url]) continue;
    seen[url] = true;
    out.push({ url: url, image: i[1], title: title });
  }

  // Completar títulos vacíos con <a class="title" href=…>
  var titleByUrl = {}, tm;
  var h3 = new RegExp("<a\\s+class=\"title\"\\s+href=\"(" + BASE_RE + "\\/[^\"]+)\"[^>]*>([^<]+)<\\/a>", "g");
  while ((tm = h3.exec(html)) !== null) titleByUrl[tm[1]] = clean(tm[2]);
  for (var k = 0; k < out.length; k++) {
    if (!out[k].title && titleByUrl[out[k].url]) out[k].title = titleByUrl[out[k].url];
  }
  return out;
}

function list(page) {
  page = page || 1;
  var url = page <= 1 ? BASE + "/series/" : BASE + "/series/page/" + page + "/";
  var res = [];
  try { res = parseCards(get(url)); } catch (e) { log("lista falló: " + e); }
  // Para el carrusel "te puede gustar" (página aleatoria): si viene vacía, usar la página 1
  if (!res.length && page > 1) res = parseCards(get(BASE + "/series/"));
  return res;
}

function search(query, page) {
  if (page && page > 1) return [];
  return parseCards(get(BASE + "/?s=" + encodeURIComponent(query)));
}

// ───────────── Detalle + capítulos ─────────────
function detail(serieUrl) {
  var html = get(serieUrl);
  var d = {}, m;

  m = /<h1[^>]*class="title"[^>]*>([^<]+)<\/h1>/.exec(html);
  if (m) d.title = clean(m[1]);
  else {
    m = /<li class="breadcrumb-item active">\s*<a[^>]*>\s*<span>([^<]+)<\/span>/.exec(html);
    if (m) d.title = clean(m[1]);
  }

  var poster = null;
  m = /<meta property="og:image" content="([^"]+)"/.exec(html);
  if (m) poster = m[1];
  if (!poster) { m = /<div class="poster">\s*<span>\s*<img[^>]*src="([^"]+)"/.exec(html); if (m) poster = m[1]; }
  if (!poster) { m = /<img[^>]*itemprop="image"[^>]*src="([^"]+)"/.exec(html); if (m) poster = m[1]; }
  if (poster) d.banner = poster;

  m = /<div\s+itemprop="description"[^>]*>\s*([\s\S]*?)<\/div>/.exec(html);
  if (m) {
    var raw = m[1].replace(/<p>/g, "\n").replace(/<\/p>/g, "").replace(/<[^>]+>/g, "").replace(/^\s+|\s+$/g, "");
    d.synopsis = clean(raw);
  }

  function uniqueList(re) {
    var out = [], seen = {}, x;
    while ((x = re.exec(html)) !== null) {
      var v = clean(x[1]);
      if (!v || seen[v]) continue;
      seen[v] = true;
      out.push(v);
    }
    return out;
  }
  var genres = uniqueList(new RegExp("href=\"" + BASE_RE + "\\/generos\\/[^\"]+\"[^>]*>([^<]+)<\\/a>", "g"));
  if (genres.length) d.genres = genres.join(", ");

  var years = [], ym, yre = new RegExp("href=\"" + BASE_RE + "\\/ano\\/(\\d{4})\\/\"[^>]*>(\\d{4})<\\/a>", "g");
  while ((ym = yre.exec(html)) !== null) if (years.indexOf(ym[1]) < 0) years.push(ym[1]);
  if (years.length) d.year = years.join(", ");

  var cast = uniqueList(new RegExp("href=\"" + BASE_RE + "\\/actores\\/[^\"]+\"[^>]*>([^<]+)<\\/a>", "g"));
  if (cast.length) d.cast = cast.join(", ");

  // Capítulos
  var block = html;
  var bm = /<div id="episodes"[^>]*>([\s\S]*?)<\/div>/.exec(html);
  if (bm) block = bm[1];

  var eps = [], epSeen = {}, e;
  var epRe = new RegExp("<a\\s+class=\"episod\"\\s+href=\"(" + BASE_RE + "\\/[^\"]+)\">\\s*([^<]+?)\\s*(?:<span[^>]*>[^<]*<\\/span>)?\\s*<\\/a>", "g");
  while ((e = epRe.exec(block)) !== null) {
    var url = e[1];
    var title = clean(e[2]) || "Capítulo";
    if (epSeen[url]) continue;
    epSeen[url] = true;
    eps.push({ url: url, title: title, image: poster || "" });
  }
  eps.sort(function (a, b) { return epNum(a.title) - epNum(b.title); });

  d.isSeries = true;
  d.episodes = eps;
  return d;
}

// ───────────── Servidores ─────────────
function sanitize(u) {
  if (!u) return null;
  u = String(u).replace(/^\s+|\s+$/g, "");
  if (!u) return null;
  u = u.replace(/bysekoze\.com/ig, "filemoon.sx");
  if (/sendvid\.com/i.test(u)) {
    var seg = u.split("?")[0].replace(/\/+$/, "").split("/").pop();
    if (seg) u = "https://sendvid.com/embed/" + seg;
  }
  if (/mxdrop|listeamed|mojon|fembed|videobin|embedv|javascript:/i.test(u)) return null;
  return u;
}

function servers(episodeUrl) {
  var html = get(episodeUrl);
  var out = [];
  if (episodeUrl && String(episodeUrl).replace(/\s/g, "")) out.push(String(episodeUrl).replace(/^\s+|\s+$/g, ""));

  // 1) enlace al proxy (esprinahy.com)
  var proxy = null, m;
  var dl = /<div class="dl-contenti">\s*<i[^>]*><\/i>\s*<a\s+href="([^"]+)"[^>]*>[^<]*<\/a>/g;
  while ((m = dl.exec(html)) !== null) {
    var c = sanitize(m[1]);
    if (c) { proxy = c; break; }
  }
  if (!proxy) {
    m = /href="(https?:\/\/(?:www\.)?esprinahy\.com\/[^"]+)"/.exec(html);
    if (m) proxy = sanitize(m[1]);
  }
  if (!proxy) return out;

  // 2) página del proxy
  var proxyHtml;
  try {
    proxyHtml = http.get(proxy, { "Referer": episodeUrl });
    if (!proxyHtml) throw new Error("vacío");
  } catch (e) {
    out.push(proxy);
    return out;
  }

  // 3) URLs reales (tokvoy.com)
  var found = [], t;
  var tv = /href="(https?:\/\/(?:www\.)?tokvoy\.com\/d\/[^"]+)"/g;
  while ((t = tv.exec(proxyHtml)) !== null) {
    var s = sanitize(t[1]);
    if (s && found.indexOf(s) < 0) found.push(s);
  }
  if (!found.length) {
    var alt = /href="(https?:\/\/[^"]+\/d\/[^"]+)"/g, a;
    while ((a = alt.exec(proxyHtml)) !== null) {
      if (a[1].indexOf("esprinahy.com") >= 0) continue;
      var s2 = sanitize(a[1]);
      if (s2 && found.indexOf(s2) < 0) found.push(s2);
    }
  }
  if (found.length) { for (var i = 0; i < found.length; i++) out.push(found[i]); }
  else out.push(proxy);
  return out;
          }
