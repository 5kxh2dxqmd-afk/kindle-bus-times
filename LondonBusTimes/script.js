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
        byId("stop-picker").className = visible ? "" : "is-hidden";
        byId("change-stop").className = visible ? "is-hidden" : "";
    }

    function apiRequest(url, onSuccess, onFailure) {
        var request = new XMLHttpRequest();
        request.open("GET", url, true);
        request.setRequestHeader("Accept", "application/json");
        request.onreadystatechange = function () {
            var data;
            if (request.readyState !== 4) {
                return;
            }
            if (request.status < 200 || request.status >= 300) {
                onFailure("HTTP " + request.status);
                return;
            }
            try {
                data = JSON.parse(request.responseText);
            } catch (ignore) {
                onFailure("unreadable response");
                return;
            }
            onSuccess(data);
        };
        request.onerror = function () {
            onFailure("network error");
        };
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

    function directionFor(stop) {
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
        return stop.indicator || "direction not supplied";
    }

    function isGroupId(id) {
        return (/^[0-9]{3}G/i).test(String(id || ""));
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

    function stopDetail(towards, indicator, id) {
        var parts = [];
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

    function saveRecent(id, name, towards, indicator) {
        var list = loadRecents();
        var next = [{ id: id, name: name, towards: towards || "", indicator: indicator || "" }];
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
                addButton(box, "stop-choice", item.name || "Bus stop", stopDetail(item.towards, item.indicator, item.id), function () {
                    resolveStop(item.id);
                });
            }(list[i]));
        }
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
        if (children.length) {
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
                addButton(results, "stop-choice", stop.commonName || stop.name || "Bus stop", stopDetail(towardsOf(stop), stop.indicator, stop.id), function () {
                    useIndividualStop(stop);
                });
            }(stops[i]));
        }
    }

    function useIndividualStop(stop) {
        var id = normaliseStopId(stop.id || stop.naptanId || "");
        if (stop.children && stop.children.length) {
            showChildStops(stop);
            return;
        }
        if (!id || isGroupId(id)) {
            setStatus("That is a stop group, not a boarding stop. Search for the stop by name instead.", true);
            return;
        }
        activeStopId = id;
        activeStopName = stop.commonName || stop.name || "TfL stop " + activeStopId;
        try {
            window.localStorage.setItem(storedStopKey, activeStopId);
        } catch (ignore) {}
        saveRecent(activeStopId, activeStopName, towardsOf(stop), stop.indicator);
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
        activeStopId = "";
        activeStopName = "";
        clearArrivals();
        clearSearchResults();
        setStatus("Checking stop…", false);
        apiRequest(API_ROOT + encodeURIComponent(stopId), function (stop) {
            if (stop.children && stop.children.length) {
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

    function searchStops() {
        var query = byId("stop-search").value.replace(/^\s+|\s+$/g, "");
        if (!query) {
            setStatus("Enter a stop name, 5-digit code or stop ID to search.", true);
            return;
        }
        if (looksLikeStopId(query)) {
            resolveStop(query);
            return;
        }
        clearSearchResults();
        setStatus("Searching TfL bus stops…", false);
        apiRequest(API_ROOT + "Search/" + encodeURIComponent(query) + "?modes=bus&includeHubs=false&maxResults=10", function (data) {
            expandMatches(data.matches || []);
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
            words(svg, Math.max(50, Math.min(590, busX)), 38, label, 14, "bold");
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
        var API_ROOT = "https://bustimes.org/";
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
            var request = new XMLHttpRequest();
            request.open("GET", url, true);
            request.setRequestHeader("Accept", "application/json");
            request.onreadystatechange = function () {
                var data;
                if (request.readyState !== 4) {
                    return;
                }
                if (request.status < 200 || request.status >= 300) {
                    onFailure("HTTP " + request.status);
                    return;
                }
                try {
                    data = JSON.parse(request.responseText);
                } catch (ignore) {
                    onFailure("unreadable response");
                    return;
                }
                onSuccess(data);
            };
            request.onerror = function () {
                onFailure("network error");
            };
            request.send(null);
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
            mapSummary.id = "vehicle-summary";
            mapPlot.id = "vehicle-plot";
            mapPlot.className = "is-hidden";
            mapStops.id = "vehicle-stops";
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
            requestJSON(API_ROOT + "vehicles.json?id=" + encodeURIComponent(vehicleId), function (positions) {
                var position;
                var coordinates;
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
                setField("updated", position.datetime || "Not available");
                RouteMap.draw({ lat: coordinates[1], lon: coordinates[0], heading: position.heading });
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
            requestJSON(API_ROOT + "api/vehicles/?search=" + encodeURIComponent(registration), function (data) {
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
            track: track
        };
    }());

    function renderArrivals(items) {
        var table, header, body, row, route, destination, due, tracking, trackButton, i, item;
        clearArrivals();
        if (!items.length) {
            setStatus("No buses are currently predicted for this stop.", false);
            return;
        }

        table = document.createElement("table");
        header = document.createElement("thead");
        header.innerHTML = "<tr><th class=\"route\">Route</th><th class=\"destination\">Towards</th><th class=\"due\">Due</th><th class=\"track\">Track</th></tr>";
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
            route.className = "route";
            destination.className = "destination";
            due.className = "due";
            tracking.className = "track";
            trackButton.type = "button";
            trackButton.className = "track-button";
            text(route, item.lineName || item.lineId || "?");
            text(destination, item.destinationName || item.towards || "Destination unavailable");
            text(due, dueText(item.timeToStation));
            text(trackButton, "Track");
            (function (prediction) {
                trackButton.onclick = function () {
                    VehicleTracker.track(prediction.vehicleId, prediction);
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
        setStatus(items.length + (items.length === 1 ? " bus prediction." : " bus predictions."), false);
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

    function loadArrivals() {
        var stopId = activeStopId;
        var request;
        if (!stopId) {
            return;
        }
        if (loading) {
            return;
        }
        loading = true;
        setStatus("Updating…", false);
        request = new XMLHttpRequest();
        request.open("GET", API_ROOT + encodeURIComponent(stopId) + "/Arrivals", true);
        request.setRequestHeader("Accept", "application/json");
        request.onreadystatechange = function () {
            var data;
            if (request.readyState !== 4) {
                return;
            }
            loading = false;
            if (request.status < 200 || request.status >= 300) {
                clearArrivals();
                setStatus("TfL could not load this stop (HTTP " + request.status + "). Check the stop ID and connection.", true);
                beginCountdown();
                return;
            }
            try {
                data = JSON.parse(request.responseText);
            } catch (ignore) {
                clearArrivals();
                setStatus("TfL sent an unreadable response. Try Refresh now.", true);
                beginCountdown();
                return;
            }
            if (!data || typeof data.length === "undefined") {
                clearArrivals();
                setStatus("TfL did not return bus arrivals for this stop.", true);
                beginCountdown();
                return;
            }
            sortArrivals(data);
            if (data.length && data[0].stationName) {
                activeStopName = data[0].stationName;
            }
            text(byId("stop-name"), activeStopName + " (" + stopId + ")");
            renderArrivals(data);
            beginCountdown();
        };
        request.onerror = function () {
            loading = false;
            clearArrivals();
            setStatus("Network error. Check that Wi-Fi is connected, then refresh.", true);
            beginCountdown();
        };
        request.send(null);
    }

    function changeStop() {
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
        var savedRefresh;
        try {
            savedStop = window.localStorage.getItem(storedStopKey) || "";
            savedRefresh = parseInt(window.localStorage.getItem(storedRefreshKey), 10);
        } catch (ignore) {}
        if (savedRefresh === 30 || savedRefresh === 60 || savedRefresh === 120 || savedRefresh === 300 || savedRefresh === 600) {
            refreshSeconds = savedRefresh;
            secondsLeft = refreshSeconds;
        }
        byId("refresh-interval").value = refreshSeconds;
        byId("refresh").onclick = loadArrivals;
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
            setStatus(loadRecents().length ? "Pick a recent stop, or add a new one." : "Add a bus stop to begin.", false);
        };
        byId("stop-search").onkeypress = function (event) {
            if ((event || window.event).keyCode === 13) {
                searchStops();
                return false;
            }
        };
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
            setStatus("Add a bus stop to begin.", false);
        }
    }

    document.addEventListener("DOMContentLoaded", setup, false);
}());
