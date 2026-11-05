/*
 * StreamingUnity — streamingunity.fun · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 *
 * La web es Inertia.js: el HTML llega casi vacío y todos los datos están en el
 * atributo data-page="{...json...}" del <div id="app">. Por eso el parseo por
 * regex de tarjetas HTML no encontraba nada. Aquí se lee ese JSON.
 */

var BASE = String(CONFIG.base || "https://streamingunity.fun").replace(/\/+$/, "");
var CDN = "https://cdn.streamingunity.fun";
var PAGE_SIZE = 60;

function clean(s) {
    return util.htmlDecode(String(s || ""))
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "");
}

function get(url, referer) {
    var headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
        "Referer": referer || (BASE + "/")
    };
    var h = http.get(url, headers);
    if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
    return h;
}

// Lee el JSON de Inertia (data-page) y devuelve props
function getProps(html) {
    var m = /data-page="([^"]*)"/.exec(html);
    if (!m) return null;
    try {
        var data = JSON.parse(util.htmlDecode(m[1]));
        return data.props || null;
    } catch (e) {
        log("StreamingUnity: error parseando data-page: " + e);
        return null;
    }
}

function getTitleId(url) {
    var m = /\/(?:titles|watch)\/(\d+)/.exec(String(url || ""));
    return m ? m[1] : null;
}

function imgUrl(images, types) {
    if (!images) return "";
    for (var t = 0; t < types.length; t++) {
        for (var i = 0; i < images.length; i++) {
            if (images[i].type === types[t] && images[i].filename) {
                return CDN + "/images/" + images[i].filename;
            }
        }
    }
    return "";
}

function titlesToCards(titles) {
    var out = [];
    if (!titles) return out;
    for (var i = 0; i < titles.length; i++) {
        var t = titles[i];
        if (!t || !t.id) continue;
        var isSerie = t.type === "tv";
        out.push({
            url: BASE + "/en/titles/" + t.id + "-" + t.slug,
            image: imgUrl(t.images, ["poster", "cover_mobile", "cover"]),
            title: clean(t.name),
            type: isSerie ? "Serie" : "Película",
            kind: isSerie ? "serie" : "movie"
        });
    }
    return out;
}

function list(page) {
    page = page || 1;
    var url = BASE + "/en/archive";
    if (page > 1) url += "?offset=" + ((page - 1) * PAGE_SIZE) + "&page=" + page;
    var props = getProps(get(url));
    return props ? titlesToCards(props.titles) : [];
}

function search(query, page) {
    page = page || 1;
    var url = BASE + "/en/search?q=" + encodeURIComponent(query);
    if (page > 1) url += "&offset=" + ((page - 1) * PAGE_SIZE) + "&page=" + page;
    var props = getProps(get(url));
    return props ? titlesToCards(props.titles) : [];
}

function mapEpisodes(titleId, seasonNumber, eps, tmdb) {
    var out = [];
    if (!eps) return out;
    for (var i = 0; i < eps.length; i++) {
        var ep = eps[i];
        out.push({
            // Se guardan season/episodio en la URL para que servers() los use
            url: BASE + "/en/watch/" + titleId + "?e=" + ep.id + "&s=" + seasonNumber + "&n=" + ep.number,
            title: clean(ep.name) || ("Episodio " + ep.number),
            season: String(seasonNumber),
            episode: String(ep.number),
            image: imgUrl(ep.images, ["cover"])
        });
    }
    return out;
}

function detail(pageUrl) {
    var id = getTitleId(pageUrl);
    if (!id) throw new Error("No se pudo extraer el ID de: " + pageUrl);

    var html = get(pageUrl);
    var props = getProps(html);
    if (!props || !props.title) throw new Error("No se encontró data-page en " + pageUrl);

    var t = props.title;
    var d = {
        title: clean(t.name),
        poster: imgUrl(t.images, ["poster", "cover_mobile", "cover"]),
        year: t.release_date ? String(t.release_date).substring(0, 4) : "",
        synopsis: clean(t.plot),
        isSeries: t.type === "tv"
    };

    var episodes = [];
    if (d.isSeries) {
        var seasons = t.seasons || [];
        var loaded = props.loadedSeason;
        for (var i = 0; i < seasons.length; i++) {
            var s = seasons[i];
            var eps = null;
            if (loaded && loaded.number === s.number && loaded.episodes) {
                eps = loaded.episodes;
            } else {
                try {
                    var sp = getProps(get(BASE + "/en/titles/" + id + "-" + t.slug + "/season-" + s.number, pageUrl));
                    if (sp && sp.loadedSeason) eps = sp.loadedSeason.episodes;
                } catch (e) {
                    log("StreamingUnity: fallo temporada " + s.number + ": " + e);
                }
            }
            episodes = episodes.concat(mapEpisodes(id, s.number, eps));
        }
    } else {
        episodes.push({
            url: BASE + "/en/watch/" + id,
            title: "Película Completa",
            season: "1",
            episode: "1",
            image: d.poster
        });
    }

    d.episodes = episodes;
    return d;
}

function servers(episodeUrl) {
    var id = getTitleId(episodeUrl);
    if (!id) return [];

    var watchUrl = BASE + "/en/watch/" + id;
    var q = /\?(.*)$/.exec(episodeUrl);
    var qs = q ? "?" + q[1].replace(/#.*$/, "") : "";
    var out = [];

    // 1) Intentar sacar el iframe/embed real de la página watch (HTML o data-page)
    try {
        var html = get(watchUrl + qs, BASE + "/");
        var m = /<iframe[^>]*src="([^"]*vixcloud\.cc[^"]*)"/.exec(html);
        if (!m) {
            var decoded = util.htmlDecode((/data-page="([^"]*)"/.exec(html) || [])[1] || "").replace(/\\\//g, "/");
            m = /(https:\/\/vixcloud\.cc\/(?:embed|playlist)\/[^"\s\\]+)/.exec(decoded);
        }
        if (m) {
            out.push({ url: util.htmlDecode(m[1]), name: "VixCloud", referer: watchUrl });
            return out;
        }

        // 2) Fallback: vixsrc.to con el tmdb_id (películas y series)
        var props = getProps(html);
        var tmdb = props && props.title ? props.title.tmdb_id : null;
        if (tmdb) {
            var s = /[?&]s=(\d+)/.exec(qs), n = /[?&]n=(\d+)/.exec(qs);
            var u = (s && n)
                ? "https://vixsrc.to/tv/" + tmdb + "/" + s[1] + "/" + n[1]
                : "https://vixsrc.to/movie/" + tmdb;
            out.push({ url: u, name: "VixSrc", referer: watchUrl });
        }
    } catch (e) {
        log("StreamingUnity servers error: " + e);
    }

    if (out.length === 0) log("StreamingUnity: sin servidor para " + episodeUrl);
    return out;
}
