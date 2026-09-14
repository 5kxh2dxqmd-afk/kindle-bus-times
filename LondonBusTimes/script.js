(function () {
    "use strict";

    var API_ROOT = "https://api.tfl.gov.uk/StopPoint/";
    var DEFAULT_REFRESH_SECONDS = 60;
    var storedStopKey = "londonBusTimes.stopId";
    var storedRefreshKey = "londonBusTimes.refreshSeconds";
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

    function useIndividualStop(stop) {
        activeStopId = normaliseStopId(stop.id || stop.naptanId);
        activeStopName = stop.commonName || stop.name || "TfL stop " + activeStopId;
        byId("stop-id").value = activeStopId;
        try {
            window.localStorage.setItem(storedStopKey, activeStopId);
        } catch (ignore) {}
        clearSearchResults();
        setPickerVisible(false);
        text(byId("stop-name"), activeStopName + " (" + activeStopId + ")");
        loadArrivals();
    }

    function showChildStops(group) {
        var results = byId("search-results");
        var help = document.createElement("div");
        var children = group.children || [];
        var i;
        clearSearchResults();
        help.className = "search-help";
        text(help, "This is a stop group (" + (group.id || group.naptanId) + "). Select an individual boarding stop; group IDs are not used for arrivals.");
        results.appendChild(help);
        for (i = 0; i < children.length; i += 1) {
            (function (child) {
                addButton(results, "stop-choice", child.commonName || group.commonName || "Bus stop", "Stop ID " + child.id + "; towards " + directionFor(child), function () {
                    useIndividualStop(child);
                });
            }(children[i]));
        }
        setStatus("Choose the side/direction of the road.", false);
    }

    function resolveStop(stopId) {
        stopId = normaliseStopId(stopId);
        if (!stopId) {
            setStatus("Enter a TfL stop ID first.", true);
            return;
        }
        activeStopId = "";
        activeStopName = "";
        clearArrivals();
        clearSearchResults();
        setStatus("Checking stop ID…", false);
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
        if (!matches.length) {
            text(help, "No bus stops matched that search.");
            help.className = "search-help";
            results.appendChild(help);
            return;
        }
        text(help, "Tap a result to check whether it is an individual stop or a stop group.");
        help.className = "search-help";
        results.appendChild(help);
        for (i = 0; i < matches.length; i += 1) {
            (function (match) {
                addButton(results, "search-result", match.name || "Bus stop", "candidate ID " + match.id + "; towards " + (match.towards || "not supplied"), function () {
                    resolveStop(match.id);
                });
            }(matches[i]));
        }
    }

    function searchStops() {
        var query = byId("stop-search").value.replace(/^\s+|\s+$/g, "");
        if (!query) {
            setStatus("Enter a stop name or 5-digit Countdown code to search.", true);
            return;
        }
        clearSearchResults();
        setStatus("Searching TfL bus stops…", false);
        apiRequest(API_ROOT + "Search/" + encodeURIComponent(query) + "?modes=bus&includeHubs=false&maxResults=10", function (data) {
            renderSearchMatches(data.matches || []);
            setStatus((data.matches || []).length + " bus-stop matches.", false);
        }, function (reason) {
            setStatus("TfL search failed (" + reason + ").", true);
        });
    }

    function sortArrivals(items) {
        items.sort(function (a, b) {
            return a.timeToStation - b.timeToStation;
        });
    }

    function renderArrivals(items) {
        var table, header, body, row, route, destination, due, i, item;
        clearArrivals();
        if (!items.length) {
            setStatus("No buses are currently predicted for this stop.", false);
            return;
        }

        table = document.createElement("table");
        header = document.createElement("thead");
        header.innerHTML = "<tr><th class=\"route\">Route</th><th class=\"destination\">Towards</th><th class=\"due\">Due</th></tr>";
        table.appendChild(header);
        body = document.createElement("tbody");
        for (i = 0; i < items.length; i += 1) {
            item = items[i];
            row = document.createElement("tr");
            route = document.createElement("td");
            destination = document.createElement("td");
            due = document.createElement("td");
            route.className = "route";
            destination.className = "destination";
            due.className = "due";
            text(route, item.lineName || item.lineId || "?");
            text(destination, item.destinationName || item.towards || "Destination unavailable");
            text(due, dueText(item.timeToStation));
            row.appendChild(route);
            row.appendChild(destination);
            row.appendChild(due);
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

    function saveStop() {
        var stopId = normaliseStopId(byId("stop-id").value);
        if (!stopId) {
            setStatus("Enter a TfL NaPTAN bus-stop ID first.", true);
            return;
        }
        byId("stop-id").value = stopId;
        resolveStop(stopId);
    }

    function changeStop() {
        setPickerVisible(true);
        setStatus("Search for a new stop, or enter its TfL stop ID.", false);
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
        byId("stop-id").value = savedStop;
        byId("refresh-interval").value = refreshSeconds;
        byId("save-stop").onclick = saveStop;
        byId("refresh").onclick = loadArrivals;
        byId("search-stop").onclick = searchStops;
        byId("change-stop").onclick = changeStop;
        byId("toggle-settings").onclick = toggleSettings;
        byId("save-settings").onclick = saveSettings;
        byId("stop-search").onkeypress = function (event) {
            if ((event || window.event).keyCode === 13) {
                searchStops();
                return false;
            }
        };
        byId("stop-id").onkeypress = function (event) {
            if ((event || window.event).keyCode === 13) {
                saveStop();
                return false;
            }
        };
        updateRefreshSummary();
        updateCountdown();
        if (savedStop) {
            resolveStop(savedStop);
        }
    }

    document.addEventListener("DOMContentLoaded", setup, false);
}());
