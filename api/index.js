const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Clés Supabase (à configurer dans Vercel Environment Variables)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Sinistre2026";

if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  console.error("CRITICAL: SUPABASE_URL ou SUPABASE_SECRET_KEY non configuré !");
}

// Initialisation du client Supabase (service role = accès complet)
let supabase = null;
if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: { persistSession: false }
  });
}

// Routeur principal
const router = express.Router();

// ─── GET /status ──────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  if (!supabase) {
    return res.json({ status: 'online', dbConnected: false, message: 'SUPABASE_URL / SUPABASE_SECRET_KEY non configurées' });
  }
  try {
    const { error } = await supabase.from('agents').select('name').limit(1);
    if (error) throw error;
    return res.json({
      status: 'online',
      dbConnected: true,
      driver: 'Supabase JS Client',
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    return res.json({
      status: 'online',
      dbConnected: false,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ─── Auth Admin ───────────────────────────────────────────────────────────────
router.post('/auth/admin', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    return res.json({ success: true });
  }
  return res.status(401).json({ success: false, message: "Mot de passe incorrect" });
});

// ─── Auth Conseiller ──────────────────────────────────────────────────────────
router.post('/auth/agent', async (req, res) => {
  const { name, password } = req.body;
  if (!name || !password) return res.status(400).json({ success: false, message: "Identifiants manquants" });
  if (!supabase) return res.status(500).json({ error: "Base de données non connectée" });

  try {
    const { data, error } = await supabase
      .from('agents')
      .select('name')
      .eq('name', name)
      .eq('password', password)
      .single();

    if (error || !data) {
      return res.status(401).json({ success: false, message: "Mot de passe incorrect" });
    }
    return res.json({ success: true, name: data.name });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /entries ─────────────────────────────────────────────────────────────
router.get('/entries', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Base de données non connectée. Vérifiez SUPABASE_URL et SUPABASE_SECRET_KEY sur Vercel." });
  try {
    const { data, error } = await supabase
      .from('entries')
      .select('*')
      .order('ts', { ascending: false });

    if (error) throw error;

    const formatted = (data || []).map(e => ({
      id: e.id,
      ref: e.ref || "",
      motifId: e.motif_id,
      callerType: e.caller_type || null,
      comment: e.comment || null,
      agent: e.agent,
      date: e.date,
      time: e.time,
      ts: e.ts ? new Date(e.ts).toISOString() : new Date().toISOString()
    }));
    return res.json(formatted);
  } catch (err) {
    console.error("Erreur GET /entries:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /entries ────────────────────────────────────────────────────────────
router.post('/entries', async (req, res) => {
  const entry = req.body;
  if (!entry || !entry.motifId || !entry.agent) {
    return res.status(400).json({ error: "Champs requis manquants (motifId, agent)" });
  }
  if (!supabase) return res.status(500).json({ error: "Base de données non connectée" });

  const id = entry.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const row = {
    id,
    ref: entry.ref || "",
    motif_id: entry.motifId,
    caller_type: entry.callerType || null,
    comment: entry.comment || null,
    agent: entry.agent,
    date: entry.date,
    time: entry.time,
    ts: entry.ts || new Date().toISOString()
  };

  try {
    const { error } = await supabase.from('entries').upsert(row, { onConflict: 'id' });
    if (error) throw error;
    return res.json({ success: true, entry: { id, ref: row.ref, motifId: row.motif_id, callerType: row.caller_type, comment: row.comment, agent: row.agent, date: row.date, time: row.time, ts: row.ts } });
  } catch (err) {
    console.error("Erreur POST /entries:", err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /agents ──────────────────────────────────────────────────────────────
router.get('/agents', async (req, res) => {
  if (!supabase) return res.status(500).json({ error: "Base de données non connectée. Vérifiez SUPABASE_URL et SUPABASE_SECRET_KEY sur Vercel." });
  try {
    const { data, error } = await supabase
      .from('agents')
      .select('name, password')
      .order('name');

    if (error) throw error;
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── POST /agents ─────────────────────────────────────────────────────────────
router.post('/agents', async (req, res) => {
  const { agents } = req.body;
  if (!Array.isArray(agents)) return res.status(400).json({ error: "Tableau 'agents' requis" });
  if (!supabase) return res.status(500).json({ error: "Base de données non connectée" });

  try {
    const names = agents.map(a => a.name);

    if (names.length > 0) {
      // Supprimer ceux qui ne sont plus dans la liste
      const { error: delError } = await supabase
        .from('agents')
        .delete()
        .not('name', 'in', `(${names.map(n => `"${n}"`).join(',')})`);
      if (delError) throw delError;

      // Upsert tous les agents
      const { error: upsertError } = await supabase
        .from('agents')
        .upsert(agents.map(a => ({ name: a.name, password: a.password })), { onConflict: 'name' });
      if (upsertError) throw upsertError;
    } else {
      const { error } = await supabase.from('agents').delete().neq('name', '');
      if (error) throw error;
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /notes ───────────────────────────────────────────────────────────────
router.get('/notes', async (req, res) => {
  if (!supabase) return res.json({ refs: {}, agents: {} });
  try {
    const { data, error } = await supabase.from('notes').select('id, data');
    if (error) throw error;

    const notes = { refs: {}, agents: {} };
    (data || []).forEach(row => {
      if (row.id === 'refs') notes.refs = row.data || {};
      if (row.id === 'agents') notes.agents = row.data || {};
    });
    return res.json(notes);
  } catch (err) {
    return res.json({ refs: {}, agents: {} });
  }
});

// ─── POST /notes ──────────────────────────────────────────────────────────────
router.post('/notes', async (req, res) => {
  const notes = req.body;
  if (!supabase) return res.status(500).json({ error: "Base de données non connectée" });

  try {
    const { error } = await supabase.from('notes').upsert([
      { id: 'refs', data: notes.refs || {} },
      { id: 'agents', data: notes.agents || {} }
    ], { onConflict: 'id' });
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─── GET /settings ────────────────────────────────────────────────────────────
router.get('/settings', async (req, res) => {
  if (!supabase) return res.json({ threshold: 3 });
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'threshold')
      .single();

    if (error || !data) return res.json({ threshold: 3 });
    return res.json({ threshold: parseInt(data.value) || 3 });
  } catch (err) {
    return res.json({ threshold: 3 });
  }
});

// ─── POST /settings ───────────────────────────────────────────────────────────
router.post('/settings', async (req, res) => {
  const { threshold } = req.body;
  if (!supabase) return res.status(500).json({ error: "Base de données non connectée" });

  try {
    const { error } = await supabase
      .from('settings')
      .upsert({ key: 'threshold', value: String(threshold) }, { onConflict: 'key' });
    if (error) throw error;
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Monter le routeur sur /api et /
app.use('/api', router);
app.use('/', router);

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Serveur Express (Supabase JS) démarré sur http://localhost:${PORT}`));
}
