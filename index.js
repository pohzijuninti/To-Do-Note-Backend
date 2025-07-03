const express = require('express');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

const db = new sqlite3.Database('./users.db', (err) => {
    if (err) return console.error(err.message);
    console.log('Connected to SQLite database.');
});

// Users Table
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT UNIQUE,
    password TEXT
    avatar TEXT
)`);

db.run(`ALTER TABLE users ADD COLUMN pinnedNoteId INTEGER`, (err) => {
    if (err && !err.message.includes('duplicate column name')) {
        console.error(err.message);
    }
});

// Notes Table
db.run(`
    CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        image TEXT,
        datetime INTEGER NOT NULL,
        color TEXT,
        userId INTEGER
    )
`);


// ---------------- Routes ----------------

app.get('/', (req, res) => {
    res.send('Welcome to To-Do Note API');
});

// ---------------- Auth ----------------

app.post('/register', (req, res) => {
    const { name, email, password, avatar } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    db.get(`SELECT * FROM users WHERE email = ?`, [email], (err, row) => {
        if (err) return res.status(500).json({ message: err.message });
        if (row) return res.status(400).json({ message: 'Email already registered' });

        db.run(
            `INSERT INTO users (name, email, password, avatar) VALUES (?, ?, ?, ?)`,
            [name, email, password, avatar || ''],
            function (err) {
                if (err) return res.status(500).json({ message: err.message });
                return res.status(200).json({
                    message: 'Registration successful',
                    user: { id: this.lastID, name, email, avatar: avatar || '' }
                });
            }
        );
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

    db.get(`SELECT * FROM users WHERE email = ? AND password = ?`, [email, password], (err, user) => {
        if (err) return res.status(500).json({ message: err.message });
        if (!user) return res.status(401).json({ message: 'Invalid email or password' });

        return res.status(200).json({
            message: `Login successful for ${user.name} (${user.email})`,
            user: { id: user.id, name: user.name, email: user.email, avatar: user.avatar }
        });
    });
});

app.get('/accounts', (req, res) => {
    db.all(`SELECT id, name, email, avatar FROM users`, [], (err, rows) => {
        if (err) return res.status(500).json({ message: err.message });
        return res.status(200).json({ accounts: rows });
    });
});

app.put('/update-user/:id', (req, res) => {
    const id = req.params.id;
    const { name, avatar } = req.body;

    if (!name && !avatar) {
        return res.status(400).json({ message: 'At least one field (name or avatar) is required to update' });
    }

    // Build dynamic query
    let updates = [];
    let values = [];

    if (name) {
        updates.push("name = ?");
        values.push(name);
    }
    if (avatar) {
        updates.push("avatar = ?");
        values.push(avatar);
    }

    values.push(id); // ID at the end

    db.run(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`, values, function (err) {
        if (err) return res.status(500).json({ message: err.message });
        if (this.changes === 0) return res.status(404).json({ message: `User with ID ${id} not found` });

        return res.status(200).json({
            message: `User with ID ${id} updated successfully`
        });
    });
});

app.delete('/account', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    db.run(`DELETE FROM users WHERE email = ?`, [email], function (err) {
        if (err) return res.status(500).json({ message: err.message });
        if (this.changes === 0) return res.status(404).json({ message: `Account with email "${email}" not found` });
        return res.status(200).json({ message: `Account with email "${email}" deleted successfully` });
    });
});


app.put('/pin-note/:userId', (req, res) => {
    const userId = req.params.userId;
    const { pinnedNoteId } = req.body;

    if (!pinnedNoteId) {
        return res.status(400).json({ message: 'Pinned note ID is required' });
    }

    db.run(`UPDATE users SET pinnedNoteId = ? WHERE id = ?`, [pinnedNoteId, userId], function (err) {
        if (err) return res.status(500).json({ message: err.message });
        if (this.changes === 0) return res.status(404).json({ message: `User with ID ${userId} not found` });

        return res.status(200).json({ message: 'Pinned note updated successfully' });
    });
});

// ---------------- Notes ----------------

app.post('/add-note', (req, res) => {
    const { title, body, image, datetime, color, userId } = req.body;

    if (!title || !body || !datetime || !userId) {
        return res.status(400).json({ message: 'Title, body, datetime, and userId are required' });
    }

    const timestamp = Number(datetime);
    if (isNaN(timestamp) || timestamp.toString().length !== 10) {
        return res.status(400).json({ message: 'datetime must be a 10-digit Unix timestamp in seconds' });
    }

    db.run(
        `INSERT INTO notes (title, body, image, datetime, color, userId) VALUES (?, ?, ?, ?, ?, ?)`,
        [title, body, image || '', timestamp, color || '', userId],
        function (err) {
            if (err) return res.status(500).json({ message: err.message });

            return res.status(200).json({
                message: 'Note added successfully',
                note: {
                    id: this.lastID,
                    title,
                    body,
                    image,
                    datetime: timestamp,
                    color: color || '',
                    userId
                }
            });
        }
    );
});


app.get('/get-notes', (req, res) => {
    db.all(`SELECT id, title, body, image, datetime, color FROM notes ORDER BY datetime DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ message: err.message });
        return res.status(200).json({ notes: rows });
    });
});

app.get('/get-notes/:id', (req, res) => {
    const userId = req.params.id;

    db.get(`SELECT pinnedNoteId FROM users WHERE id = ?`, [userId], (err, userRow) => {
        if (err) return res.status(500).json({ message: err.message });
        if (!userRow) return res.status(404).json({ message: `User with ID ${userId} not found` });

        db.all(`SELECT id, title, body, image, datetime, color FROM notes WHERE userId = ? ORDER BY datetime DESC`, [userId], (err, rows) => {
            if (err) return res.status(500).json({ message: err.message });
            return res.status(200).json({ pinnedNoteId: userRow.pinnedNoteId, notes: rows });
        });
    });
});


app.put('/update-note/:id', (req, res) => {
    const id = req.params.id;
    const { title, body, image, datetime, color } = req.body;

    if (!title || !body || !datetime) {
        return res.status(400).json({ message: 'Title, body, and datetime are required' });
    }

    const timestamp = Number(datetime);
    if (isNaN(timestamp) || timestamp.toString().length !== 10) {
        return res.status(400).json({ message: 'datetime must be a 10-digit Unix timestamp in seconds' });
    }

    db.run(`UPDATE notes SET title = ?, body = ?, image = ?, datetime = ?, color = ? WHERE id = ?`,
        [title, body, image || '', timestamp, color || '', id],
        function (err) {
            if (err) return res.status(500).json({ message: err.message });
            if (this.changes === 0) return res.status(404).json({ message: `Note with ID ${id} not found` });

            return res.status(200).json({
                message: `Note with ID ${id} updated successfully`,
                note: { id, title, body, image, datetime: timestamp, color: color || '' }
            });
        }
    );
});

app.delete('/delete-note/:id', (req, res) => {
    const id = req.params.id;

    db.run(`DELETE FROM notes WHERE id = ?`, [id], function (err) {
        if (err) return res.status(500).json({ message: err.message });
        if (this.changes === 0) return res.status(404).json({ message: `Note with ID ${id} not found` });
        return res.status(200).json({ message: `Note with ID ${id} deleted successfully` });
    });
});

// ---------------- Listen ----------------

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
