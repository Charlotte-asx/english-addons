/*
 * StreamingUnity — streamingunity.fun · Películas y Series
 * Funciones: list(page) · search(query, page) · detail(url) · servers(episodeUrl)
 * El servidor de video real está embebido vía iframe apuntando a vixcloud.cc.
 */

// La base viene del index.json (campo "base").
var BASE = String(CONFIG.base || "https://streamingunity.fun").replace(/\/+$/, "");

function clean(s) {
    return util.htmlDecode(String(s || ""))
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .replace(/^\s+|\s+$/g, "");
}

function abs(u) {
    u = String(u || "");
    if (!u) return "";
    if (/^https?:/i.test(u)) return u;
    if (u.indexOf("//") === 0) return "https:" + u;
    return BASE + (u.charAt(0) === "/" ? "" : "/") + u;
}

// Extrae el ID numérico del título desde la URL (ej: /en/titles/66502-the-greatest -> 66502)
function getTitleId(url) {
    var m = /\/(?:titles|watch)\/(\d+)/.exec(url);
    return m ? m[1] : null;
}

function get(url, referer) {
    var headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
        "Referer": referer || (BASE + "/")
    };
    var h = http.get(url, headers);
    if (!h) throw new Error("Sin respuesta (HTTP " + http.status() + ") de " + url);
    return h.replace(/[\r\n]+/g, "");
}

function parseCardList(html) {
    var out = [];
    if (!html) return out;
    
    // En la búsqueda y archivo, las tarjetas suelen tener la clase "ssr-title-card" o "movie-card"
    var m, cre = /<div[^>]*class="[^"]*(?:ssr-title-card|movie-card)[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*(?:ssr-title-card|movie-card)|$)/g;
    
    while ((m = cre.exec(html)) !== null) {
        var block = m[1];
        // Buscar el enlace al título
        var um = /href="((?:https?:\/\/[^"\/]+)?\/(?:en\/)?titles\/[^"]+)"/.exec(block);
        if (!um) continue;
        
        var url = abs(um[1]);
        var id = getTitleId(url);
        if (!id) continue;

        // Buscar imagen (suele estar en el style del div o en un img)
        var im = /url\((https:\/\/cdn\.streamingunity\.fun\/images\/[^)]+)\)/.exec(block) || /<img[^>]*src="(https:\/\/cdn\.streamingunity\.fun\/images\/[^"]+)"/.exec(block);
        
        // Buscar título (h3 o el alt de la imagen)
        var tm = /<h3[^>]*>([^<]+)<\/h3>/.exec(block) || /alt="([^"]+)"/.exec(block);
        
        // Determinar si es serie o película (por la URL o por un badge de texto)
        var isSerie = url.indexOf("/titles/") >= 0 && block.indexOf("TV") >= 0; // Heurística simple
        
        out.push({
            url: url,
            image: im ? im[1] : "",
            title: tm ? clean(tm[1]) : "Sin título",
            type: isSerie ? "Serie" : "Película",
            kind: isSerie ? "serie" : "movie"
        });
    }
    return out;
}

function list(page) {
    page = page || 1;
    // La página de archivo tiene paginación
    var url = BASE + "/en/archive" + (page > 1 ? "?page=" + page : "");
    return parseCardList(get(url));
}

function search(query, page) {
    page = page || 1;
    var url = BASE + "/en/search?q=" + encodeURIComponent(query) + (page > 1 ? "&page=" + page : "");
    return parseCardList(get(url));
}

function detail(pageUrl) {
    var id = getTitleId(pageUrl);
    if (!id) throw new Error("No se pudo extraer el ID del título de: " + pageUrl);

    var html = get(pageUrl);
    var d = { isSeries: false };

    // Título
    var m = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    if (m) d.title = clean(m[1]);

    // Poster
    m = /<img[^>]*src="(https:\/\/cdn\.streamingunity\.fun\/images\/[^"]+)"[^>]*class="[^"]*(?:poster|logo)[^"]*"/.exec(html);
    if (!m) m = /<meta property="og:image" content="([^"]+)"/.exec(html);
    if (m) d.poster = m[1];

    // Año
    m = /<span[^>]*>(\d{4})<\/span>/.exec(html);
    if (m) d.year = m[1];

    // Sinopsis
    m = /<p[^>]*>([\s\S]*?)<\/p>/.exec(html); // Buscar una descripción larga
    if (m) d.synopsis = clean(m[1]);

    // Detectar si es serie
    var isTv = html.indexOf('"type":"tv"') >= 0 || html.indexOf('"seasons_count"') >= 0;
    d.isSeries = isTv;

    var episodes = [];
    
    if (isTv) {
        // El HTML contiene un JSON con los episodios. Buscamos los IDs (scws_id)
        // En el archivo detail.txt vimos la estructura de "seasons" con "episodes" y "scws_id"
        var seasonMatches = html.match(/"number":\d+[\s\S]*?"episodes":\[[\s\S]*?\]/g);
        
        if (seasonMatches) {
            // Parseamos el JSON de la página (data-page) para obtener los episodios de forma fiable
            var pageDataMatch = /data-page="([^"]+)"/.exec(html);
            if (pageDataMatch) {
                try {
                    // El HTML tiene entidades, hay que decodificarlas
                    var jsonStr = util.htmlDecode(pageDataMatch[1]);
                    var pageData = JSON.parse(jsonStr);
                    
                    if (pageData.props && pageData.props.loadedSeason && pageData.props.loadedSeason.episodes) {
                        var eps = pageData.props.loadedSeason.episodes;
                        for (var i = 0; i < eps.length; i++) {
                            var ep = eps[i];
                            episodes.push({
                                url: pageUrl + "#s" + ep.season_id + "-e" + ep.number, // URL ficticia para identificar
                                title: "T" + (i+1) + " - " + ep.name,
                                season: String(i+1), // Usamos el índice como temporada si no hay número claro
                                episode: String(ep.number),
                                image: ep.images && ep.images[0] ? "https://cdn.streamingunity.fun/images/" + ep.images[0].filename : "",
                                _scws_id: ep.scws_id // Guardamos el ID real para servers()
                            });
                        }
                    }
                } catch (e) {
                    log("Error parseando JSON de episodios: " + e);
                }
            }
        }
        
        // Si no encontramos episodios por JSON, intentamos con el HTML (fallback)
        if (episodes.length === 0) {
            // Buscar enlaces a /watch/ que son episodios
            var re = /href="([^"]*\/watch\/\d+[^"]*)"[^>]*>[\s\S]*?<span[^>]*>([^<]*)<\/span>/g;
            while ((m = re.exec(html)) !== null) {
                episodes.push({
                    url: abs(m[1]),
                    title: clean(m[2]) || "Episodio",
                    season: "1",
                    episode: String(episodes.length + 1),
                    image: "",
                    _scws_id: null // Se extraerá en servers
                });
            }
        }
    } else {
        // Película
        episodes.push({
            url: pageUrl,
            title: "Película Completa",
            season: "1",
            episode: "1",
            image: d.poster || "",
            _scws_id: null // Se extraerá en servers
        });
    }

    d.episodes = episodes;
    return d;
}

function servers(episodeUrl) {
    var titleId = getTitleId(episodeUrl);
    if (!titleId) {
        log("StreamingUnity: No se pudo obtener el ID del título de " + episodeUrl);
        return [];
    }

    // Determinar si es película o serie para la URL de watch
    // El servidor siempre es el mismo endpoint /watch/{id} y luego se extrae el iframe
    var watchUrl = BASE + "/en/watch/" + titleId;
    
    // Si es un episodio específico, podemos intentar añadir el parámetro de episodio si la web lo soporta
    // En StreamingUnity, el watch suele cargar el primer episodio o el seleccionado vía JS.
    // Para simplificar, cargamos el watch del título y buscamos el iframe de vixcloud.
    
    var html = get(watchUrl, episodeUrl);
    var out = [];

    // Buscar el iframe de vixcloud en el HTML
    // En el archivo detail.txt vimos que la preview tiene un embed_url con token.
    // En el watch, el reproductor debería estar en un iframe.
    var m = /<iframe[^>]*src="([^"]*vixcloud\.cc[^"]*)"/.exec(html);
    
    if (m) {
        var iframeUrl = m[1];
        // El iframe de vixcloud a veces tiene el token en la URL, lo usamos directamente
        // Como el reproductor es el mismo, solo devolvemos esa URL como "servidor"
        out.push({
            url: iframeUrl,
            name: "VixCloud",
            referer: watchUrl
        });
    } else {
        // Plan B: buscar el embed_url en el JSON de la página
        var pageDataMatch = /data-page="([^"]+)"/.exec(html);
        if (pageDataMatch) {
            try {
                var jsonStr = util.htmlDecode(pageDataMatch[1]);
                var pageData = JSON.parse(jsonStr);
                if (pageData.props && pageData.props.title && pageData.props.title.preview && pageData.props.title.preview.embed_url) {
                    out.push({
                        url: pageData.props.title.preview.embed_url,
                        name: "VixCloud",
                        referer: watchUrl
                    });
                }
            } catch (e) {
                log("Error parseando JSON para servidores: " + e);
            }
        }
    }

    if (out.length === 0) {
        log("StreamingUnity: No se encontró el iframe de vixcloud en " + watchUrl);
    }

    return out;
      }
