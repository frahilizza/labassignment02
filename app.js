// ======================================
// 1. Map
// ======================================
var map = L.map('map').setView([33.65, 73.06], 12);

L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles &copy; Esri' }
).addTo(map);

var markers = L.layerGroup().addTo(map);

// ======================================
// 2. State + helpers
// ======================================
var editingId = null;      // null = adding, number = editing
var picked = null;         // {lat, lng} chosen on the map
var picking = false;

var $ = function (id) { return document.getElementById(id); };

// If the page was opened as a file (file:///...), talk to the server directly
var API_BASE = location.protocol === 'file:' ? 'http://localhost:3000' : '';

function showMessage(text) { $('message').textContent = text || ''; }

async function api(path, method, body) {
    var response;
    try {
        response = await fetch(API_BASE + '/api' + path, {
            method: method || 'GET',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
    } catch (e) {
        throw new Error('Cannot reach the server. Is "npm start" running? Open http://localhost:3000');
    }
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
}

// Symbol: colour by severity, ring by status
function severityColor(s) {
    if (s === 'High') return '#d62839';
    if (s === 'Medium') return '#f4a300';
    return '#2a9d68';
}

// ======================================
// 3. Load + draw issues (with filters)
// ======================================
async function loadIssues() {
    showMessage('');
    var p = new URLSearchParams();
    if ($('typeFilter').value)    p.set('type', $('typeFilter').value);
    if ($('statusFilter').value)  p.set('status', $('statusFilter').value);
    if ($('search').value.trim()) p.set('q', $('search').value.trim());

    try {
        var issues = await api('/issues?' + p.toString());
        var stats = await api('/stats');

        markers.clearLayers();
        issues.forEach(drawIssue);

        $('summary').textContent =
            'Showing ' + issues.length + ' of ' + stats.total + ' issues  |  ' +
            'Open: ' + stats.open + '  In progress: ' + stats.in_progress +
            '  Resolved: ' + stats.resolved;
    } catch (e) {
        $('summary').textContent = 'Could not load data';
        showMessage(e.message);
    }
}

function drawIssue(i) {
    var m = L.circleMarker([i.latitude, i.longitude], {
        radius: 9,
        color: '#000',
        weight: i.status === 'Resolved' ? 1 : 3,
        fillColor: severityColor(i.severity),
        fillOpacity: 0.9,
        dashArray: i.status === 'In Progress' ? '3 3' : null
    });

    var html =
        '<b>' + escapeHtml(i.title) + '</b><br>' +
        'Type: ' + escapeHtml(i.issue_type) + '<br>' +
        'Severity: ' + escapeHtml(i.severity) + '<br>' +
        'Status: ' + escapeHtml(i.status) + '<br>' +
        'Reported by: ' + escapeHtml(i.reported_by || '-') + '<br>' +
        escapeHtml(i.description || '') +
        '<br><button onclick="editIssue(' + i.issue_id + ')">Update</button>';

    m.bindPopup(html);
    m._issue = i;
    m.addTo(markers);
}

function escapeHtml(t) {
    return String(t).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
}

// ======================================
// 4. Legend (bug fix: legend control must be created first)
// ======================================
var legend = L.control({ position: 'bottomright' });
legend.onAdd = function () {
    var div = L.DomUtil.create('div', 'legend');
    div.innerHTML =
        '<b>Severity (fill)</b><br>' +
        '<span class="dot high"></span>High<br>' +
        '<span class="dot medium"></span>Medium<br>' +
        '<span class="dot low"></span>Low<br>' +
        '<b>Status (outline)</b><br>' +
        '<span class="dot thick"></span>Open<br>' +
        '<span class="dot dashed"></span>In Progress<br>' +
        '<span class="dot thin"></span>Resolved';
    return div;
};
legend.addTo(map);

// ======================================
// 5. Filters
// ======================================
['typeFilter', 'statusFilter'].forEach(function (id) {
    $(id).addEventListener('change', loadIssues);
});
$('search').addEventListener('input', loadIssues);
$('resetBtn').addEventListener('click', function () {
    $('typeFilter').value = '';
    $('statusFilter').value = '';
    $('search').value = '';
    loadIssues();
});

// ======================================
// 6. Add a new issue (click the map to choose the location)
// ======================================
$('addBtn').addEventListener('click', function () {
    editingId = null;
    picking = true;
    showMessage('Click on the map to choose the location of the issue.');
});

map.on('click', function (e) {
    if (!picking) return;
    picking = false;
    showMessage('');
    picked = e.latlng;
    openForm(null);
});

function openForm(issue) {
    $('formTitle').textContent = issue ? 'Update issue #' + issue.issue_id : 'Report an issue';
    $('title').value = issue ? issue.title : '';
    $('issue_type').value = issue ? issue.issue_type : 'Pothole';
    $('severity').value = issue ? issue.severity : 'Medium';
    $('status').value = issue ? issue.status : 'Open';
    $('description').value = issue ? (issue.description || '') : '';
    $('coords').textContent =
        'Location: ' + picked.lat.toFixed(5) + ', ' + picked.lng.toFixed(5);
    $('issueDialog').showModal();
}

// ======================================
// 7. Update an existing issue
// ======================================
window.editIssue = function (id) {
    var found = null;
    markers.eachLayer(function (m) { if (m._issue.issue_id === id) found = m._issue; });
    if (!found) return;
    editingId = id;
    picked = { lat: found.latitude, lng: found.longitude };
    map.closePopup();
    openForm(found);
};

// ======================================
// 8. Save (POST or PUT)
// ======================================
$('issueCancel').addEventListener('click', function () { $('issueDialog').close(); });

$('issueForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    var body = {
        title: $('title').value,
        issue_type: $('issue_type').value,
        severity: $('severity').value,
        status: $('status').value,
        description: $('description').value,
        latitude: picked.lat,
        longitude: picked.lng
    };
    try {
        if (editingId) {
            await api('/issues/' + editingId, 'PUT', body);
        } else {
            await api('/issues', 'POST', body);
        }
        $('issueDialog').close();
        loadIssues();
    } catch (err) {
        alert(err.message);
    }
});

// ======================================
// 9. Start
// ======================================
loadIssues();