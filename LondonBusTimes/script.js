(function () {
    "use strict";

    var API_ROOT = "https://api.tfl.gov.uk/StopPoint/";
    var DEFAULT_REFRESH_SECONDS = 60;
    var storedStopKey = "londonBusTimes.stopId";
    var storedRefreshKey = "londonBusTimes.refreshSeconds";
    var storedRecentKey = "londonBusTimes.recentStops";
    var MAX_RECENT = 5;
    var timer = null;
    var refreshSeconds = DEFAULT_REFRESH_SECONDS;
    var secondsLeft = refreshSeconds;
    var loading = false;
    var activeStopId = "";
    var activeStopName = "";
    var APP_VERSION = "1.2.0";
    var VERSION_URL = "https://raw.githubusercontent.com/5kxh2dxqmd-afk/kindle-bus-times/master/version.json";
    var storedFilterKey = "londonBusTimes.routeFilters";
    var storedModeKey = "londonBusTimes.searchMode";
    var REQUEST_TIMEOUT_MS = 20000;
    var searchMode = "bus";
    var STALE_LIMIT_SECONDS = 1800;
    var STATUS_REFRESH_MS = 300000;
    var lastArrivals = { stopId: "", items: [], fetchedAt: 0 };
    var showingStale = false;
    var activeStopLines = [];
    var pickerShown = true;
    var retries = 0;
    var statusKey = "";
    var statusFetchedAt = 0;

    function byId(id) {
        return document.getElementById(id);
    }

    function text(node, value) {
        if (node) {
            node.innerHTML = "";
            node.appendChild(document.createTextNode(value));
        }
    }

    function normaliseStopId(value) {
        return value.replace(/^\s+|\s+$/g, "").toUpperCase();
    }

    function setStatus(message, isError) {
        var status = byId("status");
        text(status, message);
        status.className = isError ? "notice error" : "notice";
    }

    function clockLabel(time) {
        var date = new Date(time);
        var hours = date.getHours();
        var minutes = date.getMinutes();
        return (hours < 10 ? "0" : "") + hours + ":" + (minutes < 10 ? "0" : "") + minutes;
    }

    function ageLabel(minutes) {
        if (minutes < 60) {
            return minutes + " min";
        }
        if (minutes < 1440) {
            return Math.round(minutes / 60) + " h";
        }
        return Math.round(minutes / 1440) + (Math.round(minutes / 1440) === 1 ? " day" : " days");
    }

    function compareVersions(a, b) {
        var partsA = String(a).split(".");
        var partsB = String(b).split(".");
        var i, x, y;
        for (i = 0; i < 3; i += 1) {
            x = parseInt(partsA[i], 10) || 0;
            y = parseInt(partsB[i], 10) || 0;
            if (x !== y) {
                return x < y ? -1 : 1;
            }
        }
        return 0;
    }

    function stripReasonPrefix(reason, name) {
        var message = String(reason || "");
        var colon = message.indexOf(":");
        if (colon > 0 && colon <= 40 && message.substring(0, colon).toUpperCase().indexOf(String(name || "").toUpperCase()) === 0) {
            return message.substring(colon + 1).replace(/^\s+/, "");
        }
        return message;
    }

    function shorten(value, max) {
        var clean = String(value || "").replace(/\s+/g, " ");
        return clean.length > max ? clean.substring(0, max - 1) + "\u2026" : clean;
    }

    function dueText(seconds) {
        var minutes;
        if (seconds <= 0) {
            return "due";
        }
        minutes = Math.ceil(seconds / 60);
        return minutes === 1 ? "1 min" : minutes + " mins";
    }

    function intervalLabel(seconds) {
        if (seconds < 60) {
            return seconds + " seconds";
        }
        if (seconds === 60) {
            return "1 min";
        }
        return (seconds / 60) + " mins";
    }

    function countdownLabel(seconds) {
        var minutes = Math.floor(seconds / 60);
        var remainder = seconds % 60;
        return "Refresh in " + minutes + ":" + (remainder < 10 ? "0" : "") + remainder;
    }

    function updateRefreshSummary() {
        text(byId("refresh-summary"), "Refreshes every " + intervalLabel(refreshSeconds));
    }

    function clearArrivals() {
        byId("arrivals").innerHTML = "";
    }

    function clearSearchResults() {
        byId("search-results").innerHTML = "";
    }

    function setPickerVisible(visible) {
        pickerShown = visible;
        byId("stop-picker").className = visible ? "" : "is-hidden";
        byId("change-stop").className = visible ? "is-hidden" : "";
        updateFilterBar();
    }

    function apiRequest(url, onSuccess, onFailure) {
        var request = new XMLHttpRequest();
        var finished = false;
        var watchdog = null;

        function finish(callback, value) {
            if (finished) {
                return;
            }
            finished = true;
            if (watchdog !== null) {
                window.clearTimeout(watchdog);
            }
            callback(value);
        }

        request.open("GET", url, true);
        request.setRequestHeader("Accept", "application/json");
        request.onreadystatechange = function () {
            var data;
            if (request.readyState !== 4) {
                return;
            }
            if (request.status === 0) {
                finish(onFailure, "network error");
                return;
            }
            if (request.status < 200 || request.status >= 300) {
                finish(onFailure, "HTTP " + request.status);
                return;
            }
            try {
                data = JSON.parse(request.responseText);
            } catch (ignore) {
                finish(onFailure, "unreadable response");
                return;
            }
            finish(onSuccess, data);
        };
        request.onerror = function () {
            finish(onFailure, "network error");
        };
        watchdog = window.setTimeout(function () {
            finish(onFailure, "timed out");
            try {
                request.abort();
            } catch (ignore) {}
        }, REQUEST_TIMEOUT_MS);
        request.send(null);
    }

    function addButton(parent, className, mainText, detailText, handler) {
        var button = document.createElement("button");
        var main = document.createElement("span");
        var detail = document.createElement("span");
        button.type = "button";
        button.className = className;
        main.className = "result-name";
        detail.className = "result-meta";
        text(main, mainText);
        text(detail, " — " + detailText);
        button.appendChild(main);
        button.appendChild(detail);
        button.onclick = handler;
        parent.appendChild(button);
    }

    function isGroupId(id) {
        return (/^(490G|HUB)/i).test(String(id || ""));
    }

    function isRailId(id) {
        return (/^(940G|910G|9400|9100)/i).test(String(id || ""));
    }

    function isRailStation(stop) {
        return (/^(940G|910G)/i).test(String(stop.id || stop.naptanId || ""));
    }

    function modeLabel(stop) {
        var names = { "tube": "Tube", "dlr": "DLR", "overground": "Overground", "elizabeth-line": "Elizabeth line", "national-rail": "National Rail", "tram": "Tram" };
        var modes = stop.modes || [];
        var labels = [];
        var i;
        for (i = 0; i < modes.length; i += 1) {
            if (names[modes[i]]) {
                labels.push(names[modes[i]]);
            }
        }
        return labels.join(", ");
    }

    function shortStationName(name) {
        return String(name || "").replace(/-Underground$/i, "").replace(/\s+(Underground|Rail|DLR|Tram)\s+Station$/i, "");
    }

    function parseIsoTime(value) {
        var match = (/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/).exec(String(value || ""));
        var time, sign, minutes;
        if (!match) {
            return NaN;
        }
        time = Date.UTC(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10), parseInt(match[4], 10), parseInt(match[5], 10), parseInt(match[6] || "0", 10));
        if (match[7] && match[7] !== "Z") {
            sign = match[7].charAt(0) === "-" ? -1 : 1;
            minutes = parseInt(match[7].substring(1, 3), 10) * 60 + parseInt(match[7].slice(-2), 10);
            time -= sign * minutes * 60000;
        }
        return time;
    }

    function towardsOf(stop) {
        var properties = stop.additionalProperties || [];
        var i;
        if (stop.towards) {
            return stop.towards;
        }
        for (i = 0; i < properties.length; i += 1) {
            if (properties[i].key === "Towards" && properties[i].value) {
                return properties[i].value;
            }
        }
        return "";
    }

    function linesOf(stop) {
        var raw = stop.lines || [];
        var result = [];
        var i;
        for (i = 0; i < raw.length; i += 1) {
            if (raw[i] && (raw[i].name || raw[i].id)) {
                result.push({ id: raw[i].id || String(raw[i].name).toLowerCase(), name: raw[i].name || raw[i].id });
            }
        }
        return result;
    }

    function stopDetail(towards, indicator, id, kind) {
        var parts = [];
        if (kind) {
            parts.push(kind);
        }
        if (indicator) {
            parts.push(indicator);
        }
        if (towards) {
            parts.push("towards " + towards);
        }
        parts.push(id);
        return parts.join(", ");
    }

    function loadRecents() {
        var list = [];
        var clean = [];
        var i;
        try {
            list = JSON.parse(window.localStorage.getItem(storedRecentKey) || "[]");
        } catch (ignore) {}
        if (!list || typeof list.length !== "number") {
            return [];
        }
        for (i = 0; i < list.length; i += 1) {
            if (list[i] && list[i].id && !isGroupId(list[i].id)) {
                clean.push(list[i]);
            }
        }
        return clean;
    }

    function saveRecent(id, name, towards, indicator, kind) {
        var list = loadRecents();
        var next = [{ id: id, name: name, towards: towards || "", indicator: indicator || "", kind: kind || "" }];
        var i;
        if (isGroupId(id)) {
            return;
        }
        for (i = 0; i < list.length && next.length < MAX_RECENT; i += 1) {
            if (list[i].id !== id) {
                next.push(list[i]);
            }
        }
        try {
            window.localStorage.setItem(storedRecentKey, JSON.stringify(next));
        } catch (ignore) {}
    }

    function renderRecents() {
        var list = loadRecents();
        var box = byId("recent-list");
        var i;
        box.innerHTML = "";
        byId("recent-stops").className = list.length ? "" : "is-hidden";
        for (i = 0; i < list.length; i += 1) {
            (function (item) {
                addButton(box, "stop-choice", item.name || "Bus stop", stopDetail(item.towards, item.indicator, item.id, item.kind), function () {
                    resolveStop(item.id);
                });
            }(list[i]));
        }
    }

    function stopCountdown() {
        if (timer !== null) {
            window.clearInterval(timer);
            timer = null;
        }
    }

    function leaveActiveStop() {
        stopCountdown();
        VehicleTracker.close();
        TrainInfo.close();
        showDisruptions([]);
        byId("filter-panel").className = "is-hidden";
        statusKey = "";
        statusFetchedAt = 0;
        showingStale = false;
        retries = 0;
        clearArrivals();
        activeStopId = "";
        activeStopName = "";
        activeStopLines = [];
        updateFilterBar();
        updateCountdown();
    }

    function setSearchMode(mode) {
        var rail = mode === "rail";
        searchMode = rail ? "rail" : "bus";
        try {
            window.localStorage.setItem(storedModeKey, searchMode);
        } catch (ignore) {}
        byId("mode-bus").className = rail ? "mode-button" : "mode-button is-on";
        byId("mode-rail").className = rail ? "mode-button is-on" : "mode-button";
        text(byId("search-label"), rail ? "Station name or ID" : "Stop name, 5-digit code or stop ID");
        byId("stop-search").placeholder = rail ? "e.g. Victoria or 940GZZLUVIC" : "e.g. Victoria, 73231 or 490008660N";
        clearSearchResults();
    }

    function openAddPanel() {
        byId("add-panel").className = "";
        byId("add-stop").className = "add-stop is-hidden";
    }

    function closeAddPanel() {
        byId("add-panel").className = "is-hidden";
        byId("add-stop").className = "add-stop";
        byId("stop-search").value = "";
        clearSearchResults();
    }

    function showPicker() {
        renderRecents();
        setPickerVisible(true);
        if (loadRecents().length) {
            closeAddPanel();
        } else {
            openAddPanel();
        }
    }

    function isBusStop(stop) {
        var modes = stop.modes || [];
        var i;
        if (!modes.length) {
            return true;
        }
        for (i = 0; i < modes.length; i += 1) {
            if (modes[i] === "bus") {
                return true;
            }
        }
        return false;
    }

    function individualStops(stop, found) {
        var children = stop.children || [];
        var i;
        if (isRailStation(stop)) {
            found.push(stop);
        } else if (children.length) {
            for (i = 0; i < children.length; i += 1) {
                individualStops(children[i], found);
            }
        } else if (stop.id && !isGroupId(stop.id) && isBusStop(stop)) {
            found.push(stop);
        }
        return found;
    }

    function renderStopChoices(stops, helpText) {
        var results = byId("search-results");
        var help = document.createElement("div");
        var i;
        clearSearchResults();
        help.className = "search-help";
        text(help, helpText);
        results.appendChild(help);
        for (i = 0; i < stops.length && i < 12; i += 1) {
            (function (stop) {
                addButton(results, "stop-choice", stop.commonName || stop.name || "Bus stop", stopDetail(towardsOf(stop), stop.indicator, stop.id, modeLabel(stop)), function () {
                    useIndividualStop(stop);
                });
            }(stops[i]));
        }
    }

    function useIndividualStop(stop) {
        var id = normaliseStopId(stop.id || stop.naptanId || "");
        if (!isRailStation(stop) && stop.children && stop.children.length) {
            showChildStops(stop);
            return;
        }
        if (!id || isGroupId(id)) {
            setStatus("That is a stop group, not a boarding stop. Search for the stop by name instead.", true);
            return;
        }
        leaveActiveStop();
        activeStopId = id;
        activeStopName = stop.commonName || stop.name || "TfL stop " + activeStopId;
        activeStopLines = linesOf(stop);
        try {
            window.localStorage.setItem(storedStopKey, activeStopId);
        } catch (ignore) {}
        saveRecent(activeStopId, activeStopName, towardsOf(stop), stop.indicator, modeLabel(stop));
        closeAddPanel();
        setPickerVisible(false);
        text(byId("stop-name"), activeStopName + " (" + activeStopId + ")");
        loadArrivals();
    }

    function showChildStops(group) {
        var stops = individualStops(group, []);
        openAddPanel();
        if (!stops.length) {
            clearSearchResults();
            setStatus("No individual bus stops were found for that ID.", true);
            return;
        }
        renderStopChoices(stops, "That ID covers several stops. Tap the one on your side of the road.");
        setStatus("Choose the side/direction of the road.", false);
    }

    function resolveStop(stopId) {
        stopId = normaliseStopId(stopId);
        if (!stopId) {
            setStatus("Enter a stop name, code or ID first.", true);
            return;
        }
        leaveActiveStop();
        clearSearchResults();
        setStatus("Checking stop…", false);
        apiRequest(API_ROOT + encodeURIComponent(stopId), function (stop) {
            if (!isRailStation(stop) && stop.children && stop.children.length) {
                showChildStops(stop);
                return;
            }
            useIndividualStop(stop);
        }, function (reason) {
            setStatus("TfL could not find this stop (" + reason + ").", true);
        });
    }

    function renderSearchMatches(matches) {
        var results = byId("search-results");
        var help = document.createElement("div");
        var i;
        clearSearchResults();
        help.className = "search-help";
        if (!matches.length) {
            text(help, "No bus stops matched that search.");
            results.appendChild(help);
            return;
        }
        text(help, "Tap a result to open its individual stops.");
        results.appendChild(help);
        for (i = 0; i < matches.length; i += 1) {
            (function (match) {
                addButton(results, "search-result", match.name || "Bus stop", match.towards ? "towards " + match.towards : match.id, function () {
                    resolveStop(match.id);
                });
            }(matches[i]));
        }
    }

    function expandMatches(matches) {
        var ids = [];
        var i;
        for (i = 0; i < matches.length && ids.length < 8; i += 1) {
            if (matches[i].id) {
                ids.push(encodeURIComponent(matches[i].id));
            }
        }
        if (!ids.length) {
            renderSearchMatches([]);
            setStatus("No bus stops matched that search.", false);
            return;
        }
        setStatus("Loading stop details…", false);
        apiRequest(API_ROOT + ids.join(","), function (data) {
            var details = Object.prototype.toString.call(data) === "[object Array]" ? data : [data];
            var stops = [];
            var seen = {};
            var found, j, k;
            for (j = 0; j < details.length; j += 1) {
                found = individualStops(details[j], []);
                for (k = 0; k < found.length; k += 1) {
                    if (!seen[found[k].id]) {
                        seen[found[k].id] = true;
                        stops.push(found[k]);
                    }
                }
            }
            if (!stops.length) {
                renderSearchMatches(matches);
                setStatus(matches.length + " bus-stop matches.", false);
                return;
            }
            renderStopChoices(stops, "Tap the stop on your side of the road.");
            setStatus(stops.length + " bus stops found.", false);
        }, function () {
            renderSearchMatches(matches);
            setStatus(matches.length + " bus-stop matches.", false);
        });
    }

    function looksLikeStopId(query) {
        return (/^[0-9]{3}[0-9A-Z]{5,12}$/i).test(query);
    }

    function renderRailMatches(matches) {
        var results = byId("search-results");
        var help = document.createElement("div");
        var i;
        clearSearchResults();
        help.className = "search-help";
        if (!matches.length) {
            text(help, "No Tube or rail stations matched that search.");
            results.appendChild(help);
            return;
        }
        text(help, "Tap the station you want.");
        results.appendChild(help);
        for (i = 0; i < matches.length; i += 1) {
            (function (match) {
                addButton(results, "stop-choice", match.name || "Station", stopDetail("", "", match.id, modeLabel(match)), function () {
                    resolveStop(match.id);
                });
            }(matches[i]));
        }
    }

    function searchStops() {
        var query = byId("stop-search").value.replace(/^\s+|\s+$/g, "");
        var rail = searchMode === "rail";
        if (!query) {
            setStatus(rail ? "Enter a station name or ID to search." : "Enter a stop name, 5-digit code or stop ID to search.", true);
            return;
        }
        if (looksLikeStopId(query)) {
            resolveStop(query);
            return;
        }
        clearSearchResults();
        setStatus(rail ? "Searching Tube and rail stations…" : "Searching TfL bus stops…", false);
        apiRequest(API_ROOT + "Search/" + encodeURIComponent(query) + (rail ? "?modes=tube,dlr,overground,elizabeth-line&includeHubs=false&maxResults=10" : "?modes=bus&includeHubs=false&maxResults=10"), function (data) {
            if (rail) {
                renderRailMatches(data.matches || []);
                setStatus((data.matches || []).length ? "Choose a station." : "No stations found.", false);
            } else {
                expandMatches(data.matches || []);
            }
        }, function (reason) {
            setStatus("TfL search failed (" + reason + ").", true);
        });
    }

    function sortArrivals(items) {
        items.sort(function (a, b) {
            return a.timeToStation - b.timeToStation;
        });
    }

    var TFL_BASE = "https://api.tfl.gov.uk/";

    /*
     * RouteMap: draws a schematic (not tile-based) plot of a tracked bus, your stop
     * and the neighbouring stops on the bus's route, north-up. Uses plain DOM/SVG
     * calls only so it works in the Kindle's old WebKit. The numbered stop list under
     * the plot is always filled in, even if SVG fails to render.
     */
    var RouteMap = (function () {
        var SVG_NS = "http://www.w3.org/2000/svg";
        var VIEW_WIDTH = 640;
        var VIEW_HEIGHT = 160;
        var STOPS_AFTER_YOURS = 2;
        var MAX_MARKERS = 12;
        var OFF_ROUTE_METRES = 400;
        var AT_STOP_METRES = 40;
        var sequenceCache = {};
        var context = null;
        var lastBus = null;
        var positionNote = "";
        var routeName = "";
        var destinationName = "";

        function setRouteLine() {
            var node = byId("vehicle-route");
            if (node) {
                text(node, routeName ? (destinationName ? routeName + " to " + destinationName : "Route " + routeName) : "");
            }
        }

        function toRadians(degrees) {
            return degrees * Math.PI / 180;
        }

        function round1(value) {
            return Math.round(value * 10) / 10;
        }

        function distanceMetres(lat1, lon1, lat2, lon2) {
            var dLat = toRadians(lat2 - lat1);
            var dLon = toRadians(lon2 - lon1);
            var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
            return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        }

        function distanceLabel(metres) {
            if (metres < 950) {
                return (Math.round(metres / 10) * 10) + " m";
            }
            return (metres / 1000).toFixed(1) + " km";
        }

        function setSummary(message) {
            text(byId("vehicle-summary"), message);
        }

        function clearDrawing() {
            var plot = byId("vehicle-plot");
            var list = byId("vehicle-stops");
            if (plot) {
                plot.innerHTML = "";
                plot.className = "is-hidden";
            }
            if (list) {
                list.innerHTML = "";
            }
        }

        function svgEl(name, attributes, parent) {
            var node = document.createElementNS(SVG_NS, name);
            var key;
            for (key in attributes) {
                if (attributes.hasOwnProperty(key)) {
                    node.setAttribute(key, String(attributes[key]));
                }
            }
            if (parent) {
                parent.appendChild(node);
            }
            return node;
        }

        function svgText(parent, x, y, content, size, anchor, weight, fill) {
            var node = svgEl("text", {
                x: round1(x),
                y: round1(y),
                "font-family": "Arial, Helvetica, sans-serif",
                "font-size": size,
                "font-weight": weight || "normal",
                "text-anchor": anchor || "start",
                fill: fill || "#000"
            }, parent);
            node.appendChild(document.createTextNode(content));
            return node;
        }

        function extractSequences(data) {
            var sequences = (data && data.stopPointSequences) || [];
            var result = [];
            var i, j, points, stops;
            for (i = 0; i < sequences.length; i += 1) {
                points = sequences[i].stopPoint || [];
                stops = [];
                for (j = 0; j < points.length; j += 1) {
                    if (typeof points[j].lat === "number" && typeof points[j].lon === "number") {
                        stops.push({
                            id: String(points[j].id || "").toUpperCase(),
                            name: points[j].name || "Bus stop",
                            lat: points[j].lat,
                            lon: points[j].lon
                        });
                    }
                }
                if (stops.length > 1) {
                    result.push(stops);
                }
            }
            return result;
        }

        function indexOfStop(stops, stopId, lat, lon) {
            var best = -1;
            var bestDistance = 120;
            var j, d;
            for (j = 0; j < stops.length; j += 1) {
                if (stops[j].id === stopId) {
                    return j;
                }
            }
            if (typeof lat !== "number" || typeof lon !== "number") {
                return -1;
            }
            for (j = 0; j < stops.length; j += 1) {
                d = distanceMetres(lat, lon, stops[j].lat, stops[j].lon);
                if (d < bestDistance) {
                    best = j;
                    bestDistance = d;
                }
            }
            return best;
        }

        /* Where along the route (fractional stop index) is this point closest to? */
        function project(stops, lat, lon) {
            var kx = 111320 * Math.cos(toRadians(lat));
            var ky = 110540;
            var best = { progress: 0, distance: Infinity };
            var i, ax, ay, bx, by, dx, dy, len2, t, px, py, dist;
            for (i = 0; i < stops.length - 1; i += 1) {
                ax = (stops[i].lon - lon) * kx;
                ay = (stops[i].lat - lat) * ky;
                bx = (stops[i + 1].lon - lon) * kx;
                by = (stops[i + 1].lat - lat) * ky;
                dx = bx - ax;
                dy = by - ay;
                len2 = dx * dx + dy * dy;
                t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
                if (t < 0) {
                    t = 0;
                } else if (t > 1) {
                    t = 1;
                }
                px = ax + t * dx;
                py = ay + t * dy;
                dist = Math.sqrt(px * px + py * py);
                if (dist < best.distance) {
                    best = { progress: i + t, distance: dist };
                }
            }
            return best;
        }

        function chooseBranch(bus) {
            var best = null;
            var i, result;
            for (i = 0; i < context.branches.length; i += 1) {
                result = project(context.branches[i].stops, bus.lat, bus.lon);
                if (!best || result.distance < best.distance) {
                    best = { branch: context.branches[i], progress: result.progress, distance: result.distance };
                }
            }
            return best;
        }

        function markerIndexes(lo, hi, stopIndex) {
            var count = hi - lo + 1;
            var step = count > MAX_MARKERS ? Math.ceil(count / (MAX_MARKERS - 1)) : 1;
            var indexes = [];
            var i;
            for (i = lo; i <= hi; i += 1) {
                if (i === lo || i === hi || i === stopIndex || (i - lo) % step === 0) {
                    indexes.push(i);
                }
            }
            return indexes;
        }

        function drawBusLabel(svg, busX, label) {
            var tagWidth = routeName ? Math.max(28, routeName.length * 10 + 14) : 0;
            var gap = routeName ? 7 : 0;
            var total = tagWidth + gap + label.length * 7.6;
            var left = Math.max(6, Math.min(VIEW_WIDTH - 6 - total, busX - total / 2));
            if (routeName) {
                svgEl("rect", { x: round1(left), y: 22, width: round1(tagWidth), height: 22, rx: 4, fill: "#000" }, svg);
                svgText(svg, left + tagWidth / 2, 38, routeName, 15, "middle", "bold", "#fff");
            }
            svgText(svg, left + tagWidth + gap, 38, label, 14, "start", "bold");
        }

        function drawPlot(markers, stopIndex, progress, straight) {
            var plot = byId("vehicle-plot");
            var count = markers.length;
            var first = count > 1 ? 80 : 320;
            var step = count > 1 ? (540 - 80) / (count - 1) : 0;
            var roadY = 80;
            var width, svg, bus, i, k, x, position, busX, label;

            function stopX(index) {
                return first + index * step;
            }
            function words(parent, px, py, content, size, weight, fill) {
                return svgText(parent, px, py, content, size, "middle", weight, fill);
            }
            function window_(parent, wx, wy, ww, wh) {
                svgEl("rect", { x: wx, y: wy, width: ww, height: wh, rx: 1, fill: "#fff" }, parent);
            }

            plot.innerHTML = "";
            plot.className = "";
            width = plot.clientWidth || VIEW_WIDTH;
            svg = svgEl("svg", {
                width: "100%",
                height: Math.round(width * VIEW_HEIGHT / VIEW_WIDTH),
                viewBox: "0 0 " + VIEW_WIDTH + " " + VIEW_HEIGHT,
                preserveAspectRatio: "xMidYMid meet"
            }, plot);

            svgEl("line", { x1: 24, y1: roadY, x2: 598, y2: roadY, stroke: "#000", "stroke-width": 5, "stroke-linecap": "round" }, svg);
            svgEl("polygon", { points: "596," + (roadY - 12) + " 622," + roadY + " 596," + (roadY + 12), fill: "#000" }, svg);

            for (i = 0; i < markers.length; i += 1) {
                x = round1(stopX(i));
                svgEl("line", { x1: x, y1: roadY, x2: x, y2: roadY + 20, stroke: "#000", "stroke-width": 3 }, svg);
                if (markers[i] === stopIndex) {
                    svgEl("rect", { x: x - 15, y: roadY + 20, width: 30, height: 30, fill: "#000" }, svg);
                    words(svg, x, roadY + 40, String(i + 1), 14, "bold", "#fff");
                    words(svg, x, roadY + 72, "YOU", 14, "bold");
                } else {
                    svgEl("circle", { cx: x, cy: roadY + 34, r: 14, fill: "#fff", stroke: "#000", "stroke-width": 3 }, svg);
                    words(svg, x, roadY + 39, String(i + 1), 14, "bold");
                }
            }

            position = 0;
            if (count > 1) {
                if (progress < markers[0]) {
                    position = -0.45;
                } else if (progress > markers[count - 1]) {
                    position = count - 1 + 0.45;
                } else {
                    for (k = 0; k < count - 1; k += 1) {
                        if (progress >= markers[k] && progress <= markers[k + 1]) {
                            position = k + (progress - markers[k]) / (markers[k + 1] - markers[k]);
                            break;
                        }
                    }
                }
            }
            busX = round1(Math.max(36, Math.min(600, stopX(position))));

            /* London double-decker, side view, facing right (direction of travel) */
            bus = svgEl("g", { transform: "translate(" + busX + "," + (roadY - 2) + ")" }, svg);
            svgEl("rect", { x: -28, y: -29, width: 56, height: 23, rx: 3, fill: "#000" }, bus);
            for (i = 0; i < 5; i += 1) {
                window_(bus, -24 + i * 8, -27, 6.5, 6);
                window_(bus, -24 + i * 8, -18, 6.5, 6);
            }
            window_(bus, 17, -27, 8, 7);
            window_(bus, 17, -17, 7, 11);
            svgEl("line", { x1: 20.5, y1: -17, x2: 20.5, y2: -6, stroke: "#000", "stroke-width": 1 }, bus);
            window_(bus, 25, -18, 2, 5);
            svgEl("circle", { cx: -18, cy: -4, r: 4.5, fill: "#000", stroke: "#fff", "stroke-width": 1.5 }, bus);
            svgEl("circle", { cx: -18, cy: -4, r: 1.5, fill: "#fff" }, bus);
            svgEl("circle", { cx: 11, cy: -4, r: 4.5, fill: "#000", stroke: "#fff", "stroke-width": 1.5 }, bus);
            svgEl("circle", { cx: 11, cy: -4, r: 1.5, fill: "#fff" }, bus);

            label = straight < AT_STOP_METRES ? "At your stop" : distanceLabel(straight) + " away";
            drawBusLabel(svg, busX, label);
        }

        function drawList(stops, markers, stopIndex, progress, straight) {
            var list = byId("vehicle-stops");
            var busShown = false;
            var i, row, number, name;

            function addBusRow() {
                row = document.createElement("div");
                row.className = "stop-row bus-row";
                row.appendChild(document.createTextNode(straight < AT_STOP_METRES ? "BUS is at your stop" : "BUS is here (" + distanceLabel(straight) + " from your stop)"));
                list.appendChild(row);
                busShown = true;
            }

            list.innerHTML = "";
            for (i = 0; i < markers.length; i += 1) {
                if (!busShown && markers[i] > progress) {
                    addBusRow();
                }
                row = document.createElement("div");
                row.className = markers[i] === stopIndex ? "stop-row is-yours" : "stop-row";
                number = document.createElement("span");
                number.className = "stop-num";
                number.appendChild(document.createTextNode(String(i + 1)));
                name = stops[markers[i]].name + (markers[i] === stopIndex ? " (your stop)" : "");
                row.appendChild(number);
                row.appendChild(document.createTextNode(name));
                list.appendChild(row);
            }
            if (!busShown) {
                addBusRow();
            }
        }

        function render(bus) {
            var choice = chooseBranch(bus);
            var stops = choice.branch.stops;
            var stopIndex = choice.branch.stopIndex;
            var yours = stops[stopIndex];
            var progress = choice.progress;
            var straight = distanceMetres(bus.lat, bus.lon, yours.lat, yours.lon);
            var atStop = straight < AT_STOP_METRES;
            var approaching = !atStop && progress < stopIndex;
            var toGo = stopIndex - Math.floor(progress);
            var lo, hi, markers, summary;

            if (approaching) {
                lo = Math.max(0, Math.floor(progress));
                hi = Math.min(stops.length - 1, stopIndex + STOPS_AFTER_YOURS);
                summary = distanceLabel(straight) + " from your stop (straight line). " +
                    (toGo <= 1 ? "Your stop is next." : toGo + " stops to go, counting yours.");
            } else {
                lo = Math.max(0, stopIndex - 2);
                hi = Math.min(stops.length - 1, stopIndex + 6, Math.max(stopIndex + 1, Math.ceil(progress) + 1));
                summary = atStop ? "The bus is at your stop." : "The bus has passed your stop and is " + distanceLabel(straight) + " beyond it (straight line).";
            }
            if (choice.distance > OFF_ROUTE_METRES) {
                summary = "Bus looks off its usual route (" + distanceLabel(choice.distance) + "). " + summary;
            }
            if (bus.ageMinutes > 3) {
                summary += " Last GPS update was " + ageLabel(bus.ageMinutes) + " ago.";
            }
            markers = markerIndexes(lo, hi, stopIndex);
            setSummary(summary);
            drawList(stops, markers, stopIndex, progress, straight);
            drawPlot(markers, stopIndex, progress, straight);
        }

        function draw(bus) {
            lastBus = bus;
            positionNote = "";
            if (!context) {
                return;
            }
            try {
                render(bus);
            } catch (error) {
                setSummary("Route map could not be drawn on this device; see the stop list.");
            }
        }

        function prepare(prediction, stopId, isCurrent) {
            var lineId = prediction && prediction.lineId ? String(prediction.lineId) : "";
            var direction = prediction && prediction.direction ? String(prediction.direction) : "";
            var key = lineId + "/" + direction;
            var wantedId = String(stopId || "").toUpperCase();
            var pending = 2;
            var stopInfo = null;
            var sequences = sequenceCache[key] || null;

            function finish() {
                var branches = [];
                var i, index;
                pending -= 1;
                if (pending > 0 || !isCurrent()) {
                    return;
                }
                if (!sequences || !sequences.length) {
                    setSummary("Route stops are unavailable (TfL route lookup failed).");
                    return;
                }
                for (i = 0; i < sequences.length; i += 1) {
                    index = indexOfStop(sequences[i], wantedId, stopInfo ? stopInfo.lat : null, stopInfo ? stopInfo.lon : null);
                    if (index >= 0) {
                        branches.push({ stops: sequences[i], stopIndex: index });
                    }
                }
                if (!branches.length) {
                    setSummary("Could not find your stop on this route's stop list.");
                    return;
                }
                context = { branches: branches };
                if (lastBus) {
                    draw(lastBus);
                } else {
                    setSummary(positionNote || "Route loaded. Waiting for the bus's live position…");
                }
            }

            context = null;
            lastBus = null;
            positionNote = "";
            clearDrawing();
            routeName = prediction && (prediction.lineName || prediction.lineId) ? String(prediction.lineName || prediction.lineId) : "";
            destinationName = prediction && prediction.destinationName ? String(prediction.destinationName) : "";
            setRouteLine();
            if (!lineId || !direction || !wantedId) {
                setSummary("Route map unavailable: TfL did not say which route or direction this bus is on.");
                return;
            }
            setSummary("Loading route stops…");

            apiRequest(API_ROOT + encodeURIComponent(wantedId), function (stop) {
                if (stop && typeof stop.lat === "number" && typeof stop.lon === "number") {
                    stopInfo = { lat: stop.lat, lon: stop.lon };
                }
                finish();
            }, function () {
                finish();
            });

            if (sequences && sequences.length) {
                finish();
            } else {
                apiRequest(TFL_BASE + "Line/" + encodeURIComponent(lineId) + "/Route/Sequence/" + encodeURIComponent(direction) + "?serviceTypes=Regular,Night&excludeCrowding=true", function (data) {
                    sequences = extractSequences(data);
                    if (sequences.length) {
                        sequenceCache[key] = sequences;
                    }
                    finish();
                }, function () {
                    finish();
                });
            }
        }

        function noPosition(message) {
            if (!lastBus) {
                positionNote = message;
                setSummary(message);
            }
        }

        function reset() {
            context = null;
            lastBus = null;
            positionNote = "";
        }

        return {
            prepare: prepare,
            draw: draw,
            noPosition: noPosition,
            reset: reset
        };
    }());

    var VehicleTracker = (function () {
        var BUSTIMES_ROOT = "https://bustimes.org/";
        var requestId = 0;
        var pollTimer = null;
        var currentRegistration = "";

        function setText(node, value) {
            if (node) {
                node.innerHTML = "";
                node.appendChild(document.createTextNode(value));
            }
        }

        function normaliseRegistration(value) {
            return (value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
        }

        function displayRegistration(value) {
            value = normaliseRegistration(value);
            if (/^[A-Z]{2}[0-9]{2}[A-Z]{3}$/.test(value)) {
                return value.substring(0, 4) + " " + value.substring(4);
            }
            return value || "Not available";
        }

        function requestJSON(url, onSuccess, onFailure) {
            apiRequest(url, onSuccess, onFailure);
        }

        function panel() {
            return byId("vehicle-detail");
        }

        function isCurrent(token) {
            return token === requestId && currentRegistration !== "";
        }

        function stopPolling() {
            if (pollTimer !== null) {
                window.clearInterval(pollTimer);
                pollTimer = null;
            }
        }

        function setField(name, value) {
            setText(byId("vehicle-" + name), value);
        }

        function addField(table, name, label, value) {
            var row = document.createElement("tr");
            var heading = document.createElement("th");
            var detail = document.createElement("td");
            heading.scope = "row";
            detail.id = "vehicle-" + name;
            setText(heading, label);
            setText(detail, value);
            row.appendChild(heading);
            row.appendChild(detail);
            table.appendChild(row);
        }

        function renderPanel(registration) {
            var detailPanel = panel();
            var closeButton = document.createElement("button");
            var title = document.createElement("h2");
            var subtitle = document.createElement("div");
            var table = document.createElement("table");
            var mapBox = document.createElement("div");
            var mapRoute = document.createElement("div");
            var mapSummary = document.createElement("div");
            var mapPlot = document.createElement("div");
            var mapStops = document.createElement("div");
            if (!detailPanel) {
                return;
            }
            detailPanel.innerHTML = "";
            detailPanel.className = "";
            closeButton.type = "button";
            closeButton.className = "vehicle-close";
            setText(closeButton, "Close");
            closeButton.onclick = close;
            setText(title, "Vehicle tracking");
            subtitle.className = "vehicle-subtitle";
            setText(subtitle, "TfL vehicle: " + displayRegistration(registration));
            table.className = "vehicle-data";
            addField(table, "registration", "Registration", displayRegistration(registration));
            addField(table, "fleet", "Fleet number", "Looking up…");
            addField(table, "operator", "Operator", "Looking up…");
            addField(table, "type", "Vehicle type", "Looking up…");
            addField(table, "position", "Live position", "Looking up…");
            addField(table, "heading", "Heading", "Waiting for live position");
            addField(table, "updated", "Updated", "Waiting for live position");
            detailPanel.appendChild(closeButton);
            detailPanel.appendChild(title);
            mapBox.id = "vehicle-map";
            mapRoute.id = "vehicle-route";
            mapSummary.id = "vehicle-summary";
            mapPlot.id = "vehicle-plot";
            mapPlot.className = "is-hidden";
            mapStops.id = "vehicle-stops";
            mapBox.appendChild(mapRoute);
            mapBox.appendChild(mapSummary);
            mapBox.appendChild(mapPlot);
            mapBox.appendChild(mapStops);
            detailPanel.appendChild(subtitle);
            detailPanel.appendChild(mapBox);
            detailPanel.appendChild(table);
        }

        function matchingVehicle(results, registration) {
            var i;
            for (i = 0; i < results.length; i += 1) {
                if (normaliseRegistration(results[i].reg) === registration) {
                    return results[i];
                }
            }
            return null;
        }

        function updateNoPosition(message) {
            setField("position", message || "No live position available.");
            setField("heading", "Not available");
            setField("updated", "Not available");
            RouteMap.noPosition(message || "No live position available.");
        }

        function loadPosition(vehicleId, token) {
            requestJSON(BUSTIMES_ROOT + "vehicles.json?id=" + encodeURIComponent(vehicleId), function (positions) {
                var position;
                var coordinates;
                var reported;
                var age;
                if (!isCurrent(token)) {
                    return;
                }
                if (!positions || !positions.length) {
                    updateNoPosition("No live position available.");
                    return;
                }
                position = positions[0];
                coordinates = position.coordinates;
                if (!coordinates || coordinates.length < 2) {
                    updateNoPosition("No live position available.");
                    return;
                }
                setField("position", coordinates[1] + ", " + coordinates[0]);
                setField("heading", typeof position.heading === "number" ? position.heading + "°" : "Not available");
                reported = parseIsoTime(position.datetime);
                age = isNaN(reported) ? 0 : Math.max(0, Math.round((new Date().getTime() - reported) / 60000));
                setField("updated", isNaN(reported) ? (position.datetime || "Not available") : clockLabel(reported) + (age >= 1 ? " (" + ageLabel(age) + " ago)" : " (just now)"));
                RouteMap.draw({ lat: coordinates[1], lon: coordinates[0], heading: position.heading, ageMinutes: age });
            }, function (reason) {
                if (!isCurrent(token)) {
                    return;
                }
                updateNoPosition("Live position unavailable (" + reason + ").");
            });
        }

        function beginPolling(vehicleId, token) {
            stopPolling();
            pollTimer = window.setInterval(function () {
                if (!isCurrent(token)) {
                    stopPolling();
                    return;
                }
                loadPosition(vehicleId, token);
            }, 30000);
        }

        function loadVehicle(registration, token) {
            requestJSON(BUSTIMES_ROOT + "api/vehicles/?search=" + encodeURIComponent(registration), function (data) {
                var vehicle;
                if (!isCurrent(token)) {
                    return;
                }
                vehicle = matchingVehicle(data.results || [], registration);
                if (!vehicle) {
                    setField("fleet", "No Bus Times vehicle record found.");
                    setField("operator", "Not available");
                    setField("type", "Not available");
                    updateNoPosition("No live position available.");
                    return;
                }
                setField("registration", displayRegistration(vehicle.reg || registration));
                setField("fleet", vehicle.fleet_number || vehicle.fleet_code || "Not available");
                setField("operator", vehicle.operator && vehicle.operator.name ? vehicle.operator.name : "Not available");
                setField("type", vehicle.vehicle_type && vehicle.vehicle_type.name ? vehicle.vehicle_type.name : "Not available");
                loadPosition(vehicle.id, token);
                beginPolling(vehicle.id, token);
            }, function (reason) {
                if (!isCurrent(token)) {
                    return;
                }
                setField("fleet", "Vehicle lookup unavailable (" + reason + ").");
                setField("operator", "Not available");
                setField("type", "Not available");
                updateNoPosition("No live position available.");
            });
        }

        function close() {
            var detailPanel = panel();
            requestId += 1;
            currentRegistration = "";
            stopPolling();
            RouteMap.reset();
            if (detailPanel) {
                detailPanel.innerHTML = "";
                detailPanel.className = "is-hidden";
            }
        }

        function track(registration, prediction) {
            var token;
            TrainInfo.close();
            close();
            requestId += 1;
            token = requestId;
            currentRegistration = normaliseRegistration(registration);
            renderPanel(currentRegistration);
            if (!currentRegistration) {
                setField("fleet", "TfL did not provide a vehicle registration.");
                setField("operator", "Not available");
                setField("type", "Not available");
                updateNoPosition("No live position available.");
                return;
            }
            RouteMap.prepare(prediction, activeStopId, function () {
                return isCurrent(token);
            });
            loadVehicle(currentRegistration, requestId);
        }

        return {
            track: track,
            close: close
        };
    }());

    /*
     * TrainInfo: Tube and rail predictions have no GPS and no registration plate, so instead
     * of the bus strip this shows what TfL reports for the train: platform, last reported
     * location and due time. It refreshes whenever the station's arrivals refresh.
     */
    var TrainInfo = (function () {
        var shown = null;

        function holder() {
            return byId("vehicle-detail");
        }

        function addRow(table, id, label) {
            var row = document.createElement("tr");
            var head = document.createElement("th");
            var cell = document.createElement("td");
            head.scope = "row";
            cell.id = "train-" + id;
            text(head, label);
            row.appendChild(head);
            row.appendChild(cell);
            table.appendChild(row);
        }

        function setCell(id, value) {
            text(byId("train-" + id), value);
        }

        function fill(prediction) {
            var expected = parseIsoTime(prediction.expectedArrival);
            var due = dueText(prediction.timeToStation);
            setCell("line", prediction.lineName || prediction.lineId || "Not available");
            setCell("train", prediction.vehicleId ? String(prediction.vehicleId) : "Not available");
            setCell("towards", shortStationName(prediction.destinationName) || prediction.towards || "Not available");
            setCell("platform", prediction.platformName || "Not available");
            setCell("location", prediction.currentLocation || "Not reported");
            setCell("due", isNaN(expected) ? due : due + " (" + clockLabel(expected) + ")");
            setCell("updated", clockLabel(lastArrivals.fetchedAt));
        }

        function close() {
            var panelNode = holder();
            if (!shown) {
                return;
            }
            shown = null;
            if (panelNode) {
                panelNode.innerHTML = "";
                panelNode.className = "is-hidden";
            }
        }

        function show(prediction) {
            var panelNode = holder();
            var closeButton = document.createElement("button");
            var title = document.createElement("h2");
            var subtitle = document.createElement("div");
            var table = document.createElement("table");
            var note = document.createElement("div");
            if (!panelNode) {
                return;
            }
            VehicleTracker.close();
            shown = { vehicleId: String(prediction.vehicleId || ""), lineId: String(prediction.lineId || "") };
            panelNode.innerHTML = "";
            panelNode.className = "";
            closeButton.type = "button";
            closeButton.className = "vehicle-close";
            text(closeButton, "Close");
            closeButton.onclick = close;
            text(title, "Train details");
            subtitle.className = "vehicle-subtitle";
            text(subtitle, (prediction.lineName || "Train") + (prediction.vehicleId ? ", train " + prediction.vehicleId : ""));
            table.className = "vehicle-data";
            addRow(table, "line", "Line");
            addRow(table, "train", "Train");
            addRow(table, "towards", "Towards");
            addRow(table, "platform", "Platform");
            addRow(table, "location", "Last seen");
            addRow(table, "due", "Due");
            addRow(table, "updated", "Updated");
            note.className = "vehicle-note";
            text(note, "Tube and rail trains have no GPS. This is TfL's last reported position, refreshed with the arrivals.");
            panelNode.appendChild(closeButton);
            panelNode.appendChild(title);
            panelNode.appendChild(subtitle);
            panelNode.appendChild(table);
            panelNode.appendChild(note);
            fill(prediction);
        }

        function update(items) {
            var found = null;
            var i;
            if (!shown) {
                return;
            }
            for (i = 0; i < items.length; i += 1) {
                if (String(items[i].vehicleId || "") === shown.vehicleId && String(items[i].lineId || "") === shown.lineId) {
                    found = items[i];
                    break;
                }
            }
            if (found) {
                fill(found);
            } else {
                setCell("location", "No longer predicted here. It has probably left or moved on.");
                setCell("due", "Gone");
                setCell("updated", clockLabel(lastArrivals.fetchedAt));
            }
        }

        return {
            show: show,
            update: update,
            close: close
        };
    }());

    function loadFilters() {
        var data = {};
        try {
            data = JSON.parse(window.localStorage.getItem(storedFilterKey) || "{}");
        } catch (ignore) {}
        return (data && typeof data === "object") ? data : {};
    }

    function selectedRoutes() {
        var list = loadFilters()[activeStopId];
        return (list && typeof list.length === "number") ? list : [];
    }

    function saveSelectedRoutes(list) {
        var data = loadFilters();
        if (list.length) {
            data[activeStopId] = list;
        } else {
            delete data[activeStopId];
        }
        try {
            window.localStorage.setItem(storedFilterKey, JSON.stringify(data));
        } catch (ignore) {}
    }

    function indexOfRoute(list, name) {
        var i;
        for (i = 0; i < list.length; i += 1) {
            if (String(list[i]).toUpperCase() === String(name).toUpperCase()) {
                return i;
            }
        }
        return -1;
    }

    function knownRoutes() {
        var names = [];
        var chosen = selectedRoutes();
        var i;
        function add(value) {
            if (value && indexOfRoute(names, value) < 0) {
                names.push(String(value));
            }
        }
        for (i = 0; i < activeStopLines.length; i += 1) {
            add(activeStopLines[i].name);
        }
        if (lastArrivals.stopId === activeStopId) {
            for (i = 0; i < lastArrivals.items.length; i += 1) {
                add(lastArrivals.items[i].lineName || lastArrivals.items[i].lineId);
            }
        }
        for (i = 0; i < chosen.length; i += 1) {
            add(chosen[i]);
        }
        names.sort(function (a, b) {
            var na = parseInt(a, 10);
            var nb = parseInt(b, 10);
            if (!isNaN(na) && !isNaN(nb) && na !== nb) {
                return na - nb;
            }
            if (isNaN(na) !== isNaN(nb)) {
                return isNaN(na) ? 1 : -1;
            }
            return a < b ? -1 : (a > b ? 1 : 0);
        });
        return names;
    }

    function lineIdFor(name) {
        var i;
        for (i = 0; i < activeStopLines.length; i += 1) {
            if (String(activeStopLines[i].name).toUpperCase() === String(name).toUpperCase() && activeStopLines[i].id) {
                return String(activeStopLines[i].id);
            }
        }
        if (lastArrivals.stopId === activeStopId) {
            for (i = 0; i < lastArrivals.items.length; i += 1) {
                if (String(lastArrivals.items[i].lineName).toUpperCase() === String(name).toUpperCase() && lastArrivals.items[i].lineId) {
                    return String(lastArrivals.items[i].lineId);
                }
            }
        }
        return String(name).toLowerCase();
    }

    function updateFilterBar() {
        var bar = byId("filter-bar");
        var selected;
        if (!bar) {
            return;
        }
        if (!activeStopId || pickerShown) {
            bar.className = "is-hidden";
            byId("filter-panel").className = "is-hidden";
            return;
        }
        selected = selectedRoutes();
        text(byId("filter-toggle"), selected.length ? "Routes: " + selected.join(", ") : "Routes: all");
        bar.className = "";
    }

    function showDisruptions(list) {
        var box = byId("disruption");
        var title = document.createElement("div");
        var shown = Math.min(list.length, 4);
        var i, row, name;
        box.innerHTML = "";
        if (!list.length) {
            box.className = "is-hidden";
            return;
        }
        title.className = "disruption-title";
        text(title, "Service alerts");
        box.appendChild(title);
        for (i = 0; i < shown; i += 1) {
            row = document.createElement("div");
            name = document.createElement("span");
            row.className = "disruption-row";
            name.className = "disruption-name";
            text(name, list[i].name + ": " + list[i].description);
            row.appendChild(name);
            if (list[i].reason) {
                row.appendChild(document.createTextNode(" " + list[i].reason));
            }
            box.appendChild(row);
        }
        if (list.length > shown) {
            row = document.createElement("div");
            row.className = "disruption-row";
            text(row, "+" + (list.length - shown) + " more routes affected");
            box.appendChild(row);
        }
        box.className = "";
    }

    function refreshDisruptions() {
        var names = selectedRoutes();
        var ids = [];
        var stopId = activeStopId;
        var key, i;
        if (!names.length) {
            names = knownRoutes();
        }
        for (i = 0; i < names.length && ids.length < 15; i += 1) {
            ids.push(encodeURIComponent(lineIdFor(names[i])));
        }
        if (!stopId || !ids.length) {
            showDisruptions([]);
            return;
        }
        key = stopId + "|" + ids.join(",");
        if (key === statusKey && new Date().getTime() - statusFetchedAt < STATUS_REFRESH_MS) {
            return;
        }
        statusKey = key;
        statusFetchedAt = new Date().getTime();
        apiRequest(TFL_BASE + "Line/" + ids.join(",") + "/Status", function (lines) {
            var found = [];
            var a, b, statuses, status, description;
            if (key !== statusKey || !lines || typeof lines.length !== "number") {
                return;
            }
            for (a = 0; a < lines.length; a += 1) {
                statuses = lines[a].lineStatuses || [];
                for (b = 0; b < statuses.length; b += 1) {
                    status = statuses[b];
                    description = status.statusSeverityDescription || "Disruption";
                    if (status.statusSeverity === 10 || description === "Good Service" || description === "No Issues") {
                        continue;
                    }
                    found.push({ name: lines[a].name || lines[a].id, description: description, reason: shorten(stripReasonPrefix(status.reason, lines[a].name || lines[a].id), 150) });
                    break;
                }
            }
            showDisruptions(found);
        }, function () {
            statusFetchedAt = 0;
        });
    }

    function afterFilterChange() {
        updateFilterBar();
        renderFilterPanel();
        if (lastArrivals.stopId === activeStopId) {
            displayArrivals(showingStale);
        }
        statusFetchedAt = 0;
        refreshDisruptions();
    }

    function toggleRoute(name) {
        var selected = selectedRoutes().slice(0);
        var at = indexOfRoute(selected, name);
        if (at >= 0) {
            selected.splice(at, 1);
        } else {
            selected.push(name);
        }
        saveSelectedRoutes(selected);
        afterFilterChange();
    }

    function renderFilterPanel() {
        var holder = byId("filter-panel");
        var names = knownRoutes();
        var selected = selectedRoutes();
        var title = document.createElement("div");
        var chips = document.createElement("div");
        var actions = document.createElement("div");
        var all = document.createElement("button");
        var done = document.createElement("button");
        var i;
        holder.innerHTML = "";
        title.className = "picker-title";
        text(title, "Show only these routes");
        holder.appendChild(title);
        if (!names.length) {
            chips.className = "search-help";
            text(chips, "Routes appear here once arrivals have loaded. Refresh, then try again.");
        }
        for (i = 0; i < names.length; i += 1) {
            (function (name) {
                var chip = document.createElement("button");
                chip.type = "button";
                chip.className = indexOfRoute(selected, name) >= 0 ? "route-chip is-on" : "route-chip";
                text(chip, name);
                chip.onclick = function () {
                    toggleRoute(name);
                };
                chips.appendChild(chip);
            }(names[i]));
        }
        holder.appendChild(chips);
        actions.className = "filter-actions";
        all.type = "button";
        done.type = "button";
        text(all, "Show all routes");
        text(done, "Done");
        all.onclick = function () {
            saveSelectedRoutes([]);
            afterFilterChange();
        };
        done.onclick = function () {
            holder.className = "is-hidden";
        };
        actions.appendChild(all);
        actions.appendChild(done);
        holder.appendChild(actions);
    }

    function toggleFilterPanel() {
        var holder = byId("filter-panel");
        if (holder.className === "is-hidden") {
            renderFilterPanel();
            holder.className = "";
        } else {
            holder.className = "is-hidden";
        }
    }

    function displayArrivals(stale) {
        var items = lastArrivals.items;
        var elapsed = stale ? Math.max(0, Math.floor((new Date().getTime() - lastArrivals.fetchedAt) / 1000)) : 0;
        var selected = selectedRoutes();
        var shown = [];
        var hidden = 0;
        var i;
        for (i = 0; i < items.length; i += 1) {
            if (items[i].timeToStation - elapsed < -60) {
                continue;
            }
            if (selected.length && indexOfRoute(selected, items[i].lineName || items[i].lineId) < 0) {
                hidden += 1;
                continue;
            }
            shown.push(items[i]);
        }
        renderArrivals(shown, elapsed, hidden);
    }

    function renderArrivals(items, elapsed, hidden) {
        var rail = isRailId(activeStopId);
        var noun = rail ? "train" : "bus";
        var table, header, body, row, route, destination, due, tracking, trackButton, platform, i, item;
        clearArrivals();
        if (!items.length) {
            setStatus(hidden ? "No " + noun + "s for your selected routes right now (" + hidden + " hidden by the route filter)." : "No " + noun + "s are currently predicted for this " + (rail ? "station" : "stop") + ".", false);
            return;
        }

        table = document.createElement("table");
        table.className = rail ? "rail" : "";
        header = document.createElement("thead");
        header.innerHTML = rail ?
                "<tr><th class=\"route line-name\">Line</th><th class=\"destination\">Towards</th><th class=\"due\">Due</th><th class=\"track\">Info</th></tr>" :
                "<tr><th class=\"route\">Route</th><th class=\"destination\">Towards</th><th class=\"due\">Due</th><th class=\"track\">Track</th></tr>";
        table.appendChild(header);
        body = document.createElement("tbody");
        for (i = 0; i < items.length; i += 1) {
            item = items[i];
            row = document.createElement("tr");
            route = document.createElement("td");
            destination = document.createElement("td");
            due = document.createElement("td");
            tracking = document.createElement("td");
            trackButton = document.createElement("button");
            route.className = rail ? "route line-name" : "route";
            destination.className = "destination";
            due.className = "due";
            tracking.className = "track";
            trackButton.type = "button";
            trackButton.className = "track-button";
            text(route, item.lineName || item.lineId || "?");
            if (rail) {
                text(destination, shortStationName(item.destinationName) || item.towards || "Destination unavailable");
                if (item.platformName) {
                    platform = document.createElement("div");
                    platform.className = "platform";
                    text(platform, item.platformName);
                    destination.appendChild(platform);
                }
            } else {
                text(destination, item.destinationName || item.towards || "Destination unavailable");
            }
            text(due, dueText(item.timeToStation - (elapsed || 0)));
            text(trackButton, rail ? "Info" : "Track");
            (function (prediction) {
                trackButton.onclick = function () {
                    if (rail) {
                        TrainInfo.show(prediction);
                    } else {
                        VehicleTracker.track(prediction.vehicleId, prediction);
                    }
                };
            }(item));
            tracking.appendChild(trackButton);
            row.appendChild(route);
            row.appendChild(destination);
            row.appendChild(due);
            row.appendChild(tracking);
            body.appendChild(row);
        }
        table.appendChild(body);
        byId("arrivals").appendChild(table);
        setStatus(items.length + " " + noun + (items.length === 1 ? " prediction." : " predictions.") + (hidden ? " " + hidden + " hidden by route filter." : ""), false);
    }

    function updateCountdown() {
        text(byId("countdown"), activeStopId ? countdownLabel(secondsLeft) : "Not scheduled");
    }

    function beginCountdown() {
        if (timer !== null) {
            window.clearInterval(timer);
        }
        secondsLeft = refreshSeconds;
        updateCountdown();
        timer = window.setInterval(function () {
            secondsLeft -= 1;
            if (secondsLeft <= 0) {
                secondsLeft = refreshSeconds;
                loadArrivals();
            }
            updateCountdown();
        }, 1000);
    }

    function arrivalsFailed(message) {
        var age;
        if (lastArrivals.stopId === activeStopId && lastArrivals.items.length) {
            age = (new Date().getTime() - lastArrivals.fetchedAt) / 1000;
            if (age <= STALE_LIMIT_SECONDS) {
                showingStale = true;
                displayArrivals(true);
                setStatus(message + " Showing the last arrivals from " + clockLabel(lastArrivals.fetchedAt) + ".", true);
                return;
            }
        }
        clearArrivals();
        setStatus(message, true);
    }

    function loadArrivals() {
        var stopId = activeStopId;
        if (!stopId || loading) {
            return;
        }
        loading = true;
        setStatus("Updating…", false);
        apiRequest(API_ROOT + encodeURIComponent(stopId) + "/Arrivals", function (data) {
            loading = false;
            if (stopId !== activeStopId) {
                loadArrivals();
                return;
            }
            if (!data || typeof data.length !== "number") {
                arrivalsFailed("TfL did not return arrivals for this stop.");
                beginCountdown();
                return;
            }
            sortArrivals(data);
            retries = 0;
            showingStale = false;
            lastArrivals = { stopId: stopId, items: data, fetchedAt: new Date().getTime() };
            text(byId("stop-name"), activeStopName + " (" + stopId + ")");
            displayArrivals(false);
            TrainInfo.update(data);
            updateFilterBar();
            refreshDisruptions();
            beginCountdown();
        }, function (reason) {
            var networkProblem = reason === "network error" || reason === "timed out";
            loading = false;
            if (stopId !== activeStopId) {
                loadArrivals();
                return;
            }
            if (networkProblem && retries < 1) {
                retries += 1;
                setStatus("Connection hiccup, retrying…", false);
                window.setTimeout(loadArrivals, 4000);
                return;
            }
            if (networkProblem) {
                arrivalsFailed("Network problem (" + reason + "). Check that Wi-Fi is connected, then refresh.");
            } else if (reason === "unreadable response") {
                arrivalsFailed("TfL sent an unreadable response. Try Refresh now.");
            } else {
                arrivalsFailed("TfL could not load this stop (" + reason + "). Check the stop ID and connection.");
            }
            beginCountdown();
        });
    }

    function checkForUpdate() {
        var label = byId("update-text");
        text(label, "Checking GitHub…");
        apiRequest(VERSION_URL + "?t=" + new Date().getTime(), function (data) {
            var latest = data && data.version ? String(data.version) : "";
            if (!latest) {
                text(label, "Could not read the latest version.");
            } else if (compareVersions(APP_VERSION, latest) < 0) {
                text(label, "Version " + latest + " is available (you have " + APP_VERSION + "). Close this app and run \"London Bus Times - Update\" from your library.");
            } else {
                text(label, "Up to date (version " + APP_VERSION + ").");
            }
        }, function (reason) {
            text(label, "Could not check for updates (" + reason + ").");
        });
    }

    function changeStop() {
        leaveActiveStop();
        text(byId("stop-name"), "Choose a boarding stop");
        showPicker();
        setStatus("Pick a recent stop, or add a new one.", false);
    }

    function toggleSettings() {
        var settings = byId("settings");
        if (settings.className === "is-hidden") {
            settings.className = "";
        } else {
            settings.className = "is-hidden";
        }
    }

    function saveSettings() {
        var chosen = parseInt(byId("refresh-interval").value, 10);
        if (chosen !== 30 && chosen !== 60 && chosen !== 120 && chosen !== 300 && chosen !== 600) {
            setStatus("Choose one of the listed refresh intervals.", true);
            return;
        }
        refreshSeconds = chosen;
        try {
            window.localStorage.setItem(storedRefreshKey, refreshSeconds);
        } catch (ignore) {}
        updateRefreshSummary();
        if (activeStopId) {
            beginCountdown();
        } else {
            secondsLeft = refreshSeconds;
            updateCountdown();
        }
        byId("settings").className = "is-hidden";
        setStatus("Auto-refresh set to every " + intervalLabel(refreshSeconds) + ".", false);
    }

    function setup() {
        var savedStop = "";
        var savedMode = "";
        var savedRefresh;
        try {
            savedStop = window.localStorage.getItem(storedStopKey) || "";
            savedMode = window.localStorage.getItem(storedModeKey) || "";
            savedRefresh = parseInt(window.localStorage.getItem(storedRefreshKey), 10);
        } catch (ignore) {}
        if (savedRefresh === 30 || savedRefresh === 60 || savedRefresh === 120 || savedRefresh === 300 || savedRefresh === 600) {
            refreshSeconds = savedRefresh;
            secondsLeft = refreshSeconds;
        }
        byId("refresh-interval").value = refreshSeconds;
        text(byId("update-text"), "Installed version " + APP_VERSION + ".");
        byId("refresh").onclick = function () {
            retries = 0;
            if (!activeStopId) {
                setStatus("Choose a stop first.", true);
                return;
            }
            loadArrivals();
        };
        byId("mode-bus").onclick = function () {
            setSearchMode("bus");
        };
        byId("mode-rail").onclick = function () {
            setSearchMode("rail");
        };
        byId("filter-toggle").onclick = toggleFilterPanel;
        byId("check-update").onclick = checkForUpdate;
        byId("search-stop").onclick = searchStops;
        byId("change-stop").onclick = changeStop;
        byId("toggle-settings").onclick = toggleSettings;
        byId("save-settings").onclick = saveSettings;
        byId("add-stop").onclick = function () {
            openAddPanel();
            clearSearchResults();
            try {
                byId("stop-search").focus();
            } catch (ignore) {}
        };
        byId("cancel-add").onclick = function () {
            closeAddPanel();
            setStatus(loadRecents().length ? "Pick a recent stop, or add a new one." : "Add a stop or station to begin.", false);
        };
        byId("stop-search").onkeypress = function (event) {
            if ((event || window.event).keyCode === 13) {
                searchStops();
                return false;
            }
        };
        setSearchMode(savedMode === "rail" ? "rail" : "bus");
        updateRefreshSummary();
        updateCountdown();
        if (savedStop && isGroupId(savedStop)) {
            try {
                window.localStorage.removeItem(storedStopKey);
            } catch (ignore) {}
            showPicker();
            resolveStop(savedStop);
        } else if (loadRecents().length) {
            showPicker();
            setStatus("Pick a recent stop, or add a new one.", false);
        } else if (savedStop) {
            resolveStop(savedStop);
        } else {
            showPicker();
            setStatus("Add a stop or station to begin.", false);
        }
    }

    document.addEventListener("DOMContentLoaded", setup, false);
}());
