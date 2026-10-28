// Express API for the Road and Traffic Issue Reporting system
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');

// ---------- Settings: change the password to YOUR postgres password ----------
const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'labassignment_2',
    user: 'postgres',
    password: '123'
});

const TYPES = ['Pothole', 'Broken Streetlight', 'Traffic Jam', 'Road Damage', 'Flooding'];
const SEVERITIES = ['Low', 'Medium', 'High'];
const STATUSES = ['Open', 'In Progress', 'Resolved'];

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Serve the website (public folder next to this file) ----------
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Validate form data ----------
function validate(b) {
    const title = (b.title || '').trim();
    const lat = Number(b.latitude);
    const lon = Number(b.longitude);
    if (title.length < 3 || title.length > 100) return 'Title must be 3-100 characters.';
    if (!TYPES.includes(b.issue_type)) return 'Invalid issue type.';
    if (!SEVERITIES.includes(b.severity)) return 'Invalid severity.';
    if (b.status && !STATUSES.includes(b.status)) return 'Invalid status.';
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) return 'Latitude must be between -90 and 90.';
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) return 'Longitude must be between -180 and 180.';
    return null;
}

// ---------- GET /api/issues  (optional ?type= &status= &q=) ----------
app.get('/api/issues', async (req, res) => {
    try {
        const where = [];
        const values = [];
        if (req.query.type)   { values.push(req.query.type);   where.push('issue_type = $' + values.length); }
        if (req.query.status) { values.push(req.query.status); where.push('status = $' + values.length); }
        if (req.query.q)      { values.push('%' + req.query.q + '%');
                                where.push('(title ILIKE $' + values.length + ' OR description ILIKE $' + values.length + ')'); }

        const sql = `
            SELECT issue_id, title, issue_type, severity, status, description,
                   reported_by, reported_at,
                   ST_X(geom) AS longitude, ST_Y(geom) AS latitude
            FROM road_issues
            ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
            ORDER BY issue_id`;
        const result = await pool.query(sql, values);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error.' });
    }
});

// ---------- GET /api/stats ----------
app.get('/api/stats', async (req, res) => {
    try {
        const r = await pool.query(`
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE status = 'Open')::int        AS open,
                   COUNT(*) FILTER (WHERE status = 'In Progress')::int AS in_progress,
                   COUNT(*) FILTER (WHERE status = 'Resolved')::int    AS resolved
            FROM road_issues`);
        res.json(r.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error.' });
    }
});

// ---------- POST /api/issues  (no login needed) ----------
app.post('/api/issues', async (req, res) => {
    const problem = validate(req.body);
    if (problem) return res.status(400).json({ error: problem });
    try {
        const b = req.body;
        const result = await pool.query(
            `INSERT INTO road_issues
               (title, issue_type, severity, status, description, reported_by, geom)
             VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326))
             RETURNING issue_id`,
            [b.title.trim(), b.issue_type, b.severity, b.status || 'Open',
             (b.description || '').trim(), 'Public user',
             Number(b.longitude), Number(b.latitude)]
        );
        res.status(201).json({ issue_id: result.rows[0].issue_id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error.' });
    }
});

// ---------- PUT /api/issues/:id  (no login needed) ----------
app.put('/api/issues/:id', async (req, res) => {
    const problem = validate(req.body);
    if (problem) return res.status(400).json({ error: problem });
    try {
        const b = req.body;
        const result = await pool.query(
            `UPDATE road_issues
             SET title = $1, issue_type = $2, severity = $3, status = $4,
                 description = $5, geom = ST_SetSRID(ST_MakePoint($6, $7), 4326)
             WHERE issue_id = $8
             RETURNING issue_id`,
            [b.title.trim(), b.issue_type, b.severity, b.status || 'Open',
             (b.description || '').trim(), Number(b.longitude), Number(b.latitude),
             Number(req.params.id)]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Record not found.' });
        res.json({ issue_id: result.rows[0].issue_id });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Database error.' });
    }
});

app.listen(3000, () => {
    console.log('Open http://localhost:3000 in your browser');
});