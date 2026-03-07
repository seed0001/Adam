const Database = require('c:/Users/aztre/Desktop/New folder (45)/adam/packages/core/node_modules/better-sqlite3');
const db = new Database('C:/Users/aztre/.adam/data/adam.db');

try {
    console.log('--- SESSION AUDIT ---');
    const sessions = db.prepare('SELECT id, user_id, channel_id, source FROM sessions').all();
    console.log(JSON.stringify(sessions, null, 2));

    console.log('\n--- EXTERNAL USER MESSAGES ---');
    // Find all messages from users that are NOT the admin ID
    const adminIdArray = ['550782786013757442'];
    const externalMessages = db.prepare(`
    SELECT e.created_at, e.content, s.user_id, s.source, s.channel_id
    FROM episodic_memory e
    JOIN sessions s ON e.session_id = s.id
    WHERE e.role = 'user' AND s.user_id NOT IN ('550782786013757442')
  `).all();
    console.log(JSON.stringify(externalMessages, null, 2));

    console.log('\n--- SUBSECT SPECIFIC AUDIT ---');
    const subsectId = '120418341775998976';
    const subsectMsgs = db.prepare(`
    SELECT e.created_at, e.content, s.channel_id
    FROM episodic_memory e
    JOIN sessions s ON e.session_id = s.id
    WHERE s.user_id = ? OR e.content LIKE ?
  `).all([subsectId, '%subsect%']);
    console.log(JSON.stringify(subsectMsgs, null, 2));

} catch (e) {
    console.error(e.message);
} finally {
    db.close();
}
